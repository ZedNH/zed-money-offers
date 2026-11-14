/**
 * The source-agnostic adapter: read offers from a page nobody wrote an adapter
 * for (§26).
 *
 * The two shipped adapters know their sites — where the listing lives, what
 * "Dining" means there, which sub-pages to follow. That knowledge is what makes
 * them good, and it is exactly what you do not have when a user pastes a link
 * to a restaurant's promo page at 11pm.
 *
 * So this one knows nothing and tries everything, in descending order of how
 * much the page is telling us on purpose:
 *
 *  1. **JSON-LD** — a site that publishes `schema.org/Offer` has *declared* its
 *     offers. Nothing guessed, so it is trusted first.
 *  2. **Embedded state** — the `__NEXT_DATA__` / RSC payload behind most modern
 *     sites. Still structured data, just not meant for us.
 *  3. **Repeated blocks** — a list of cards that each mention money. The
 *     repetition is the signal: one priced box is a page, six is a catalogue.
 *  4. **Whole-page text** — last resort, for a single-offer landing page where
 *     there is nothing to repeat.
 *
 * Each layer is only tried when the one above found nothing, because a page
 * that declares its offers should not also be scraped by heuristic — that is
 * how one offer becomes three near-duplicates.
 *
 * What it deliberately does not do is decide whether the text *is* an offer.
 * That judgement stays in the shared normalisation stage, so a page whose only
 * number is a phone number produces no rows rather than a nonsense one.
 */

import type { AdapterContext, AdapterResult, OfferSourceAdapter, RawOffer } from '../adapter.ts';
import { mediaEnabled, mediaLinks, readMedia } from '../media.ts';
import {
  extractEmbeddedState,
  extractJsonLd,
  extractRepeatedBlocks,
  findOfferLikeNodes,
  htmlToText,
  offerNodes,
  sameOriginLinks,
} from '../extract.ts';

/** Words that make a same-origin link worth following on a scan. */
const OFFER_LINK = /offer|deal|discount|promo|campaign|privilege|benefit|voucher|coupon|sale/i;

/** How much whole-page text is worth handing the parser as a single offer. */
const MAX_PAGE_TEXT = 4_000;

export type GenericAdapterOptions = {
  /** Where to start. */
  url: string;
  /**
   * Follow same-origin links whose URL looks offer-ish.
   *
   * Off by default. A user pasting a link means *this page*, and quietly
   * crawling twenty more is both slower than they expect and ruder to the site
   * than they agreed to.
   */
  follow?: boolean;
  /** Which instrument to attribute what it finds to, when the page does not say. */
  instrument?: OfferSourceAdapter['instrument'];
};

/**
 * Build a one-off adapter for a single URL.
 *
 * The key is derived from the host so that re-scanning the same site updates
 * its rows rather than forking them — `dedupeKey` is built from the adapter
 * key, and a key that changed per scan would defeat the whole deduplication
 * stage.
 */
export function createGenericAdapter(options: GenericAdapterOptions): OfferSourceAdapter {
  const { url, follow = false, instrument = 'any' } = options;
  const host = safeHost(url);

  return {
    key: `scan_${host.replace(/[^a-z0-9]+/gi, '_')}`,
    displayName: host,
    // The provider is unknown for an arbitrary page. `other` keeps it out of
    // provider-specific advice rather than claiming a bank it cannot verify.
    provider: 'other',
    instrument,
    seeds: [url],
    collect: (context) => collectGeneric(url, follow, context),
  };
}

async function collectGeneric(url: string, follow: boolean, context: AdapterContext): Promise<AdapterResult> {
  const warnings: string[] = [];
  let pagesFetched = 0;

  const seed = await context.fetchPage(url);
  pagesFetched += 1;

  if (!seed.ok || seed.body === '') {
    const detail = seed.problem ?? `status ${String(seed.status)}`;
    return { offers: [], pagesFetched, warnings: [`${url}: ${detail}`], failed: true };
  }
  if (!seed.contentType.includes('html') && !seed.contentType.includes('json')) {
    return {
      offers: [],
      pagesFetched,
      warnings: [`${url} is ${seed.contentType || 'an unknown type'}, not a web page`],
      failed: true,
    };
  }

  const fromSeed = readPage(seed.body, url);
  context.log(`${url}: ${String(fromSeed.length)} candidate${fromSeed.length === 1 ? '' : 's'} on the page itself`);

  if (!follow) return { offers: [...fromSeed, ...(await fromMedia([{ html: seed.body, url }], context))], pagesFetched, warnings };

  /*
   * A listing page very often carries none of the terms.
   *
   * BRAC Bank's offers page is the canonical shape: eight cards, each showing a
   * title, a tag and an expiry — and the discount only inside the *image*.
   * There is no figure in the text to read, so the listing alone can never
   * yield more than the one offer whose percentage happens to be in its title.
   * The terms are one click away, on each offer's own page, as prose.
   */
  const links = detailLinks(seed.body, url).slice(0, Math.max(0, context.maxPages - 1));
  context.log(`following ${String(links.length)} offer page${links.length === 1 ? '' : 's'}`);

  const fromDetails: RawOffer[] = [];
  const bodies: { html: string; url: string }[] = [{ html: seed.body, url }];
  for (const link of links) {
    const page = await context.fetchPage(link);
    pagesFetched += 1;

    if (!page.ok || page.body === '' || !page.contentType.includes('html')) {
      warnings.push(`${link}: ${page.problem ?? `status ${String(page.status)}`}`);
      continue;
    }
    fromDetails.push(...readPage(page.body, link));
    bodies.push({ html: page.body, url: link });
  }

  // When the detail pages produced anything, the listing's own blocks are the
  // same offers minus their terms — keeping both would file every promotion
  // twice, once complete and once as a bare title.
  const offers = fromDetails.length > 0 ? fromDetails : fromSeed;
  // Offers that live only in a banner picture or a PDF of terms.
  offers.push(...(await fromMedia(bodies, context)));
  return { offers, pagesFetched, warnings };
}

/**
 * Offers read out of the pictures and PDFs on these pages (see `media.ts`).
 * A picture is one offer; a PDF is usually a list of partners, so each line
 * with a figure in it is read on its own.
 */
async function fromMedia(bodies: readonly { html: string; url: string }[], context: AdapterContext): Promise<RawOffer[]> {
  if (!mediaEnabled()) return [];
  const seen = new Set<string>();
  const links = bodies.flatMap((b) => mediaLinks(b.html, b.url)).filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
  if (links.length === 0) return [];
  const read = await readMedia(links, context.log);
  const out: RawOffer[] = [];
  for (const { url, text } of read) {
    if (url.toLowerCase().includes('.pdf')) {
      for (const line of text.split('\n')) {
        const l = line.trim();
        if (l.length >= 8 && /[A-Za-z]{3}/.test(l) && /\d\s*%|(?:tk|bdt|৳)\s*\d/i.test(l)) out.push(fromText(l.replace(/\s{2,}/g, '\n'), url));
      }
    } else {
      out.push(fromText(text, url));
    }
  }
  return out;
}

/**
 * Links from a listing page that look like the individual offers on it.
 *
 * Two signals, strongest first. A link *below the listing's own path* —
 * `/en/offers` → `/en/offers/hyatt-place-sea-food-festival` — is about as clear
 * as web structure gets, and it is what almost every bank and shop does. Only
 * when that finds nothing does it fall back to matching offer-ish words
 * anywhere in the URL, which is looser and catches more navigation chrome.
 */
function detailLinks(html: string, seedUrl: string): string[] {
  const all = sameOriginLinks(html, seedUrl);

  let seedPath = '/';
  try {
    seedPath = new URL(seedUrl).pathname.replace(/\/+$/, '');
  } catch {
    /* fall through to the loose match */
  }

  const deeper = all.filter((link) => {
    try {
      const path = new URL(link).pathname.replace(/\/+$/, '');
      return seedPath !== '' && path.startsWith(`${seedPath}/`) && path.length > seedPath.length + 1;
    } catch {
      return false;
    }
  });

  const chosen = deeper.length > 0 ? deeper : all.filter((link) => OFFER_LINK.test(link));
  return [...new Set(chosen)].filter((link) => link !== seedUrl);
}

/** Run the four layers over one page, stopping at the first that yields rows. */
function readPage(html: string, pageUrl: string): RawOffer[] {
  const declared = offerNodes(extractJsonLd(html));
  if (declared.length > 0) return declared.map((node) => fromRecord(node, pageUrl));

  const state = extractEmbeddedState(html);
  if (state != null) {
    const nodes = findOfferLikeNodes(state);
    if (nodes.length > 0) return nodes.map((node) => fromRecord(node, pageUrl));
  }

  const blocks = extractRepeatedBlocks(html);
  if (blocks.length > 0) {
    return blocks.map((block) => fromText(block.text, pageUrl));
  }

  const text = htmlToText(html).trim();
  return text === '' ? [] : [fromText(text.slice(0, MAX_PAGE_TEXT), pageUrl)];
}

/**
 * A structured node → a raw offer.
 *
 * Keys vary wildly between sites, so each field is read from a list of the
 * names that field actually goes by. Everything is kept verbatim: the
 * normaliser is the only thing allowed to draw conclusions.
 */
function fromRecord(node: Record<string, unknown>, pageUrl: string): RawOffer {
  const description = [
    pick(node, ['description', 'details', 'offerdetails', 'terms', 'termsandconditions', 'summary']),
    pick(node, ['discount', 'discountpercentage', 'cashback', 'benefit', 'savings', 'offer', 'percentage']),
  ]
    .filter((v) => v !== '')
    .join('\n');

  const title = pick(node, ['title', 'name', 'headline', 'offertitle', 'campaignname']);

  return {
    merchant: pick(node, ['merchant', 'merchantname', 'partner', 'outlet', 'brand', 'shopname', 'store', 'vendor']),
    categoryLabel: pick(node, ['category', 'categoryname', 'type', 'segment', 'industry']),
    title: title === '' ? description.slice(0, 120) : title,
    description: description === '' ? title : description,
    eligibilityText: pick(node, ['cardtype', 'card', 'eligibility', 'paymentmethod', 'instrument', 'paywith', 'bank']),
    locationText: pick(node, ['location', 'address', 'branch', 'branches', 'city', 'area', 'outletaddress']),
    validityText: pick(node, ['validity', 'validtill', 'validfrom', 'enddate', 'startdate', 'expiry', 'period']),
    sourceUrl: pageUrl,
  };
}

/**
 * A block of prose → a raw offer.
 *
 * There are no fields to read, so the whole text goes to every prose slot the
 * normaliser looks at. That is not laziness: the eligibility and location
 * parsers are pattern-matchers over free text, and giving them the full block
 * is exactly how they find "Visa Platinum" or "Gulshan branch" in a sentence
 * that was never divided into fields.
 */
function fromText(text: string, pageUrl: string): RawOffer {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const firstLine = lines[0] ?? text;

  /**
   * An offer card is nearly always a name followed by the terms, so a short
   * first line with no figures in it is the shop.
   *
   * Bounded tightly on purpose: a long first line is a sentence, and a first
   * line containing a price is the offer itself. Guessing wrong here would put
   * "Enjoy 20% discount up to Tk 800" in the merchant column of every row.
   */
  const looksLikeName =
    lines.length > 1 && firstLine.length <= 40 && !/\d/.test(firstLine) && !/[.!?]$/.test(firstLine);

  return {
    merchant: looksLikeName ? firstLine : '',
    categoryLabel: '',
    title: firstLine.slice(0, 140),
    description: text,
    eligibilityText: text,
    locationText: text,
    validityText: text,
    sourceUrl: pageUrl,
  };
}

/** First non-empty value among the given key spellings, stringified and trimmed. */
function pick(node: Record<string, unknown>, keys: readonly string[]): string {
  const normalised = new Map<string, unknown>();
  for (const [key, value] of Object.entries(node)) {
    normalised.set(key.toLowerCase().replace(/[^a-z]/g, ''), value);
  }

  for (const key of keys) {
    const value = normalised.get(key);
    const text = stringify(value);
    if (text !== '') return text;
  }
  return '';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringify).filter((v) => v !== '').join(', ');
  if (value != null && typeof value === 'object') {
    // schema.org nests constantly — `{ name: 'X' }`, `{ address: { streetAddress } }`.
    const record = value as Record<string, unknown>;
    for (const key of ['name', 'value', 'text', 'streetaddress', 'addresslocality']) {
      const hit = Object.entries(record).find(([k]) => k.toLowerCase().replace(/[^a-z]/g, '') === key);
      if (hit != null) {
        const text = stringify(hit[1]);
        if (text !== '') return text;
      }
    }
  }
  return '';
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'scanned-page';
  }
}
