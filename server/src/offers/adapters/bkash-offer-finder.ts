/**
 * bKash campaigns, via Offer Finder.
 *
 * ## What the source actually is
 *
 * `offer-finder.com` publishes no `robots.txt` — a 404, which states no
 * restrictions — and serves this collector normally. It is a Next.js app that
 * renders nothing useful into static markup: the campaign list arrives as a
 * React Server Components flight payload, streamed through
 * `self.__next_f.push(...)`.
 *
 * That turns out to be the best case rather than the worst. The flight payload
 * is the *data* the page was built from, not the markup it was rendered into,
 * so it survives a redesign entirely and it carries fields the visible page
 * never shows — coupon codes, campaign start and end timestamps, per-merchant
 * terms in both English and Bangla. `decodeRscFlight` reads it; see
 * `extract.ts`.
 *
 * ## On being refused
 *
 * If the site ever does start refusing this collector, the adapter stops after
 * three refusals and the run reports the source as **declined** rather than
 * empty. It does not disguise itself: there is one user-agent string, it names
 * the project, and it carries a contact URL. Spoofing a browser to get past a
 * block is evasion, and an empty catalogue and a refused one mean completely
 * different things to a user deciding whether to trust "no offers found".
 *
 * An operator with a structured feed they are permitted to use sets
 * `OFFER_FINDER_API_BASE` and the adapter prefers it — which is what the brief
 * asks for anyway.
 */

import type { AdapterContext, AdapterResult, OfferSourceAdapter, RawOffer } from '../adapter.ts';
import { extractRepeatedBlocks, findOfferLikeNodes, extractEmbeddedState, sameOriginLinks } from '../extract.ts';

const ORIGIN = 'https://offer-finder.com';

/**
 * The site's own public JSON endpoint.
 *
 * `/api/brands` returns every participating merchant with its campaign
 * attached — offer title and value in English and Bangla, the coupon code, and
 * the category. This is the structured source the brief asks to prefer, and it
 * beats reading the rendered page in every way that matters: it is the data the
 * page is built from, it does not move when the design does, and it carries the
 * coupon code, which the listing page never shows.
 *
 * The rendered-page path below is retained as a fallback for the day this
 * endpoint changes shape, so the source degrades rather than disappearing.
 */
const BRANDS_ENDPOINT = `${ORIGIN}/api/brands`;

/**
 * Seeds for the fallback crawl. Category slugs are read off the home page's own
 * navigation rather than guessed — the site has more of them than the brief
 * lists (`home-decor`, `entertainment`, `miscellaneous`), and a guessed slug
 * 404s silently, leaving a whole shelf missing.
 */
const SEED_PATHS = ['/', '/campaigns?mega_campaign_slug=payment-means-bkash'] as const;

/** Set when an operator has a different structured feed they are permitted to use. */
const API_BASE = process.env['OFFER_FINDER_API_BASE'] ?? null;

/**
 * Ceiling on merchants ingested per run.
 *
 * Effectively off. The endpoint lists around twenty thousand outlets, and the
 * earlier 4,000 cap was a guess at what a client could hold that turned out to
 * cost real coverage: an outlet that is not collected is a shop the user can
 * search for and be told, wrongly, that nothing applies there. IndexedDB
 * handles the full set comfortably.
 *
 * The limit stays as a runaway guard, and when it bites the run **says so** —
 * silently truncating would report a partial catalogue as a complete one.
 */
const MAX_BRANDS = Number(process.env['OFFER_FINDER_MAX_BRANDS'] ?? 50_000);

/**
 * bKash's own category ids.
 *
 * A fallback for the id → name map that is otherwise read live from
 * `/api/offer-locations`. That call is a second network round trip over a 400 KB
 * response, and when it fails every offer lands in `other` — which is the
 * difference between "I need groceries" finding two thousand shops and finding
 * none. These ids are stable and cheap to carry.
 */
const CATEGORY_FALLBACK: Readonly<Record<number, string>> = {
  1: 'Lifestyle',
  2: 'Grocery & Superstores',
  3: 'Food & Beverage',
  4: 'Home Decor & Electronics',
  5: 'Online Shopping',
  6: 'Ticket & Travel',
  7: 'Entertainment',
  9: 'Healthcare & Pharmacy',
  13: 'Miscellaneous',
};

/**
 * Names the numeric category ids that `/api/brands` uses.
 *
 * The brand feed carries `category_id` and an `offer_type_en` that says "Coupon
 * Code" — which is the *mechanism*, not the shelf. Without this second call
 * every one of four thousand offers lands in `other` and the advisor can never
 * answer "I need groceries".
 */
const LOCATIONS_ENDPOINT = `${ORIGIN}/api/offer-locations`;

/** One row of `/api/brands`. Everything optional: this is someone else's schema. */
type BrandRow = {
  name?: unknown;
  slug?: unknown;
  campaign?: {
    offer_title_en?: unknown;
    offer_value_en?: unknown;
    offer_title_bn?: unknown;
    offer_value_bn?: unknown;
    offer_type_en?: unknown;
    offer_identifier?: unknown;
    category_id?: unknown;
    slug?: unknown;
  } | null;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Build the category id → name map.
 *
 * The names are buried in a district/thana/category tree, so this walks for
 * `{ id, name_en }` pairs rather than assuming a shape. A failure here is not
 * fatal: the offers still land, they just land uncategorised, and that degrades
 * far better than not collecting them at all.
 */
async function categoryNames(context: AdapterContext): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  const page = await context.fetchPage(LOCATIONS_ENDPOINT);
  if (!page.ok || page.body === '') return names;

  let parsed: unknown;
  try {
    parsed = JSON.parse(page.body);
  } catch {
    return names;
  }

  const queue: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (node == null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (typeof record['id'] === 'number' && typeof record['name_en'] === 'string') {
      names.set(record['id'], record['name_en']);
    }
    queue.push(...Object.values(record));
  }

  context.log(`resolved ${String(names.size)} category names`);
  return names;
}

/**
 * Read the brand feed.
 *
 * Rows without a campaign are skipped: the feed lists participating merchants,
 * and one with no campaign attached is a merchant with no current offer, not an
 * offer we failed to parse.
 */
async function collectFromBrandFeed(context: AdapterContext): Promise<AdapterResult | null> {
  const page = await context.fetchPage(BRANDS_ENDPOINT);

  // Say *why*. The first version logged only "brand feed unavailable", and when
  // twenty thousand offers went missing there was nothing to work from — a
  // timeout, a 304 and a 500 are three different problems with three different
  // fixes, and they all looked identical.
  if (!page.ok) {
    // Surfaced as a warning as well as a log line, so the run report shows the
    // source *failed* rather than appearing to succeed with nothing. Twenty
    // thousand offers going missing must never look like "no offers this month".
    const reason = page.problem ?? `HTTP ${String(page.status)}`;
    context.log(`brand feed failed: ${reason}`);
    return { offers: [], pagesFetched: 1, warnings: [`brand feed unavailable: ${reason}`], failed: true };
  }
  if (page.notModified) {
    context.log('brand feed unchanged since the last run (304) — keeping what is already stored');
    return null;
  }
  if (page.body === '') {
    context.log('brand feed returned an empty body');
    return null;
  }

  const categories = await categoryNames(context);

  let rows: unknown;
  try {
    rows = JSON.parse(page.body);
  } catch (error) {
    context.log(`brand feed was not JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!Array.isArray(rows)) {
    context.log('brand feed was JSON but not a list of brands');
    return null;
  }

  const { offers, warnings } = offersFromRows(rows as BrandRow[], categories);
  context.log(`brand feed: ${String(offers.length)} merchants with live campaigns`);
  return { offers, pagesFetched: 2, warnings };
}


/** The campaign words that name a shelf, for rows the search feed sends without a category id. */
const SHELF_WORDS: [RegExp, string][] = [
  [/superstore|super-?shop|grocery|bazar|mart/i, 'Grocery & Superstores'],
  [/food|restaurant|dine|dining|cafe|pizza|burger/i, 'Food & Beverage'],
  [/hotel|travel|ticket|air|flight|bus|tour|outing/i, 'Ticket & Travel'],
  [/fashion|lifestyle|cloth|shoe|salon|beauty|wedding|jewel/i, 'Lifestyle'],
  [/electronic|gadget|home|decor|furniture/i, 'Home Decor & Electronics'],
  [/online|e-?commerce|shopping/i, 'Online Shopping'],
  [/health|pharma|medicine|hospital|diagnostic/i, 'Healthcare & Pharmacy'],
  [/cinema|movie|entertainment|game|park/i, 'Entertainment'],
  [/school|course|education|learning/i, 'Education'],
];

function shelfFrom(slug: string): string {
  for (const [words, shelf] of SHELF_WORDS) if (words.test(slug)) return shelf;
  return '';
}

/** Brand rows (from the feed or the search) → offers. */
function offersFromRows(rows: readonly BrandRow[], categories: ReadonlyMap<number, string>): { offers: RawOffer[]; warnings: string[] } {
  const offers: RawOffer[] = [];
  const warnings: string[] = [];
  let withCampaign = 0;

  for (const row of rows) {
    const campaign = row.campaign;
    if (campaign == null) continue;
    withCampaign += 1;
    if (offers.length >= MAX_BRANDS) continue;

    const merchant = text(row.name).replace(/^[,\s(]+|[)\s]+$/g, '');
    if (merchant === '') continue;

    const title = text(campaign.offer_title_en) || text(campaign.offer_title_bn);
    const value = text(campaign.offer_value_en) || text(campaign.offer_value_bn);
    const code = text(campaign.offer_identifier);

    // The value line carries the arithmetic ("Up to BDT 200 Discount"); the
    // title carries the code. Both go to the parser, code last so a stray digit
    // in it cannot be read as an amount.
    const description = [value, title, code === '' ? '' : `Coupon code: ${code}`]
      .filter((part) => part !== '')
      .join('. ');

    offers.push({
      merchant,
      // The named shelf, not the coupon mechanism. Live map first, then the
      // built-in ids, then nothing — an unknown id is better left blank for the
      // merchant-name pass to handle than forced into a wrong shelf.
      categoryLabel:
        typeof campaign.category_id === 'number'
          ? (categories.get(campaign.category_id) ?? CATEGORY_FALLBACK[campaign.category_id] ?? '')
          : shelfFrom(text(campaign.slug)),
      title: title === '' ? merchant : title,
      description,
      eligibilityText: 'bKash payment',
      locationText: '',
      validityText: '',
      sourceUrl: text(campaign.slug) === '' ? BRANDS_ENDPOINT : `${ORIGIN}/campaigns/${text(campaign.slug)}`,
    });
  }

  if (withCampaign > MAX_BRANDS) {
    warnings.push(
      `feed listed ${String(withCampaign)} merchants with campaigns; ingested the first ` +
        `${String(MAX_BRANDS)}. Raise OFFER_FINDER_MAX_BRANDS to take more.`,
    );
  }

  if (withCampaign > MAX_BRANDS) {
    warnings.push(`feed listed ${String(withCampaign)} merchants with campaigns; ingested the first ${String(MAX_BRANDS)}.`);
  }
  return { offers, warnings };
}

/**
 * Every brand through the site's own search.
 *
 * Since late 2026 `/api/brands` answers only a search, twenty brands at a
 * time, with no paging. So this asks for every letter and digit, and where a
 * term fills all twenty slots, asks again one letter longer on either side
 * ("a" → "ab", "ba" …) until every term comes back short of twenty — at that
 * point every brand containing it has been seen. About eight hundred brands
 * take a thousand-odd requests at the polite pace (30 minutes): fine for a
 * daily job, and it stops early once new names stop turning up.
 */
const SEARCH_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const SEARCH_BUDGET = Number(process.env['OFFER_FINDER_SEARCH_BUDGET'] ?? 1_400);
const SEARCH_PAGE = 20;

async function collectFromSearch(context: AdapterContext): Promise<AdapterResult | null> {
  const seen = new Map<string, BrandRow>();
  const asked = new Set<string>();
  const queue = [...SEARCH_ALPHABET];
  let requests = 0;
  let failures = 0;
  let sinceNew = 0;
  while (queue.length > 0 && requests < SEARCH_BUDGET) {
    const term = queue.shift()!;
    if (asked.has(term)) continue;
    asked.add(term);
    requests += 1;
    const page = await context.fetchPage(`${BRANDS_ENDPOINT}?search=${encodeURIComponent(term)}`);
    if (!page.ok || page.body === '') {
      failures += 1;
      if (failures >= 10 && seen.size === 0) break;
      continue;
    }
    let rows: unknown;
    try {
      rows = JSON.parse(page.body);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    const before = seen.size;
    for (const row of rows as BrandRow[]) {
      const key = text(row.slug) || text(row.name);
      if (key !== '' && !seen.has(key)) seen.set(key, row);
    }
    sinceNew = seen.size > before ? 0 : sinceNew + 1;
    // Saturated: hundreds of searches in a row with nothing new.
    if (sinceNew >= 400 && seen.size > 0) break;
    if (rows.length >= SEARCH_PAGE && term.length < 4) {
      for (const c of SEARCH_ALPHABET) {
        queue.push(term + c);
        queue.push(c + term);
      }
    }
  }
  context.log(`brand search: ${String(seen.size)} brands from ${String(requests)} searches`);
  if (seen.size === 0) return null;
  const categories = await categoryNames(context);
  const { offers, warnings } = offersFromRows([...seen.values()], categories);
  return { offers, pagesFetched: requests + 1, warnings };
}

export const bkashOfferFinderAdapter: OfferSourceAdapter = {
  key: 'bkash_offer_finder',
  displayName: 'Offer Finder (bKash campaigns)',
  provider: 'bkash',
  instrument: 'mfs',
  termsUrl: `${ORIGIN}/terms`,
  seeds: SEED_PATHS.map((path) => `${ORIGIN}${path}`),

  async collect(context: AdapterContext): Promise<AdapterResult> {
    if (API_BASE != null) return collectFromApi(context, API_BASE);

    // Structured first. Only if the feed is gone does this fall back to reading
    // the rendered pages.
    const fromFeed = await collectFromBrandFeed(context);
    if (fromFeed != null && fromFeed.offers.length > 0) return fromFeed;
    // The feed now answers only searches: list every brand through them.
    const fromSearch = await collectFromSearch(context);
    if (fromSearch != null && fromSearch.offers.length > 0) return fromSearch;
    context.log('brand feed unavailable — falling back to the rendered pages');

    const offers: RawOffer[] = [];
    const warnings: string[] = [];
    const visited = new Set<string>();
    let pagesFetched = 0;
    let refusals = 0;

    const queue: string[] = SEED_PATHS.map((path) => `${ORIGIN}${path}`);

    while (queue.length > 0 && pagesFetched < context.maxPages) {
      const url = queue.shift();
      if (url == null || visited.has(url)) continue;
      visited.add(url);

      const page = await context.fetchPage(url);
      pagesFetched += 1;

      if (page.notModified) continue;

      if (page.status === 403 || page.status === 401 || page.status === 429) {
        refusals += 1;
        // Three refusals is a policy, not a hiccup. Stop asking.
        if (refusals >= 3) {
          warnings.push(
            `${ORIGIN} is declining automated access (HTTP ${String(page.status)}). ` +
              'Stopping rather than disguising the collector. Set OFFER_FINDER_API_BASE if you have ' +
              'permitted access to a structured feed.',
          );
          break;
        }
        continue;
      }

      if (!page.ok || page.body === '') {
        warnings.push(`${url}: ${page.problem ?? 'empty response'}`);
        continue;
      }

      // This kind of site is usually a JS app, so embedded state is the layer
      // most likely to pay off — try it before falling back to block scraping.
      const before = offers.length;
      const state = extractEmbeddedState(page.body);
      if (state != null) {
        for (const node of findOfferLikeNodes(state)) {
          const raw = fromStateNode(node, url);
          if (raw != null) offers.push(raw);
        }
      }

      // The block heuristic is the floor, and only runs when the payload above
      // yielded nothing for *this* page.
      if (offers.length === before) {
        for (const block of extractRepeatedBlocks(page.body)) {
          const lines = block.text.split('\n');
          const merchant = lines[0]?.trim() ?? '';
          if (merchant === '') continue;
          offers.push({
            merchant,
            categoryLabel: categoryFromUrl(url),
            title: merchant,
            description: block.text,
            eligibilityText: '',
            locationText: '',
            validityText: lines.find((l) => /valid|until|till|\d{1,2}\s+\w+\s+20\d\d/i.test(l))?.trim() ?? '',
            sourceUrl: url,
          });
        }
      }

      // Follow the category listings the home page advertises, and the detail
      // page behind each campaign — the detail page is where the coupon code
      // and the validity dates live.
      for (const link of sameOriginLinks(page.body, url)) {
        if (!/\/campaigns(\?|\/|$)/.test(link)) continue;
        if (visited.has(link) || queue.includes(link)) continue;
        queue.push(link);
      }
    }

    return { offers, pagesFetched, warnings };
  },
};

/** The preferred path: a structured endpoint the operator is permitted to call. */
async function collectFromApi(context: AdapterContext, base: string): Promise<AdapterResult> {
  const page = await context.fetchPage(`${base.replace(/\/$/, '')}/offers`);
  if (!page.ok || page.body === '') {
    return { offers: [], pagesFetched: 1, warnings: [`offer feed unavailable: ${page.problem ?? 'empty'}`] };
  }

  try {
    const parsed: unknown = JSON.parse(page.body);
    const nodes = findOfferLikeNodes(parsed);
    const offers = nodes.map((node) => fromStateNode(node, page.url)).filter((o): o is RawOffer => o != null);
    return { offers, pagesFetched: 1, warnings: [] };
  } catch {
    return { offers: [], pagesFetched: 1, warnings: ['offer feed returned something that is not JSON'] };
  }
}

/**
 * Turn one node of a page's state tree into a raw offer.
 *
 * Every field is read defensively and every absent field stays absent. A node
 * that yields no merchant and no description is not an offer, whatever else it
 * looked like to the heuristic — returning `null` here is what keeps analytics
 * payloads out of the catalogue.
 */
function fromStateNode(node: Record<string, unknown>, sourceUrl: string): RawOffer | null {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const direct = node[key];
      if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();
      // Keys arrive as merchantName, merchant_name and MerchantName.
      const loose = Object.entries(node).find(
        ([k, v]) => typeof v === 'string' && k.toLowerCase().replace(/[^a-z]/g, '') === key.toLowerCase(),
      );
      if (loose != null) return String(loose[1]).trim();
    }
    return '';
  };

  const merchant = pick('merchant', 'merchantname', 'brand', 'outlet', 'partner', 'shopname', 'name');
  const description = pick('description', 'details', 'offerdetails', 'terms', 'summary', 'title');
  if (merchant === '' && description === '') return null;

  return {
    merchant,
    categoryLabel: pick('category', 'categoryname', 'type'),
    title: pick('title', 'headline', 'offertitle') || merchant,
    description: description || merchant,
    eligibilityText: pick('cardtype', 'eligibility', 'paymentmethod', 'eligiblecards'),
    locationText: pick('location', 'address', 'city', 'branch', 'area'),
    validityText: [pick('validfrom', 'startdate'), pick('validtill', 'validto', 'enddate', 'expiry')]
      .filter((s) => s !== '')
      .join(' to '),
    sourceUrl,
  };
}

function categoryFromUrl(url: string): string {
  const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  return segment.replace(/-/g, ' ');
}
