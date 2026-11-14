/**
 * City Bank.
 *
 * Its offers-and-rewards section is a hub of category pages
 * (`/offers-and-rewards/discount/dining-offers`, `.../retail`, and so on), each
 * listing merchant cards. `robots.txt` allows everything under
 * `/offers-and-rewards/`; only `/search`, `/api` and `/_next` are disallowed,
 * and this adapter touches none of them.
 *
 * The interesting property of this source, and the reason §4 of the brief exists
 * at all, is that its offers name **card tiers explicitly**:
 *
 *     "CITY BANK AMERICAN EXPRESS PLATINUM RESERVE, PLATINUM, GOLD CREDIT CARDS"
 *
 * A collector that flattened that to "City Bank" would tell a Blue cardholder to
 * use a discount they cannot have. So the tier text is captured verbatim and
 * mapped to catalogue product keys — and where a named tier is not in the
 * catalogue, that is recorded as a warning rather than silently dropped, because
 * an unknown tier means the *user's* card might be it.
 *
 * The adapter discovers its own sub-pages from the hub rather than carrying a
 * hard-coded list, so a new category section is picked up without a code change.
 */

import type { AdapterContext, AdapterResult, OfferSourceAdapter, RawOffer } from '../adapter.ts';
import { extractRepeatedBlocks, extractJsonLd, htmlToText, offerNodes, sameOriginLinks } from '../extract.ts';

const ORIGIN = 'https://www.citybankplc.com';

/** Hub pages named in the brief. Sub-pages are discovered from them. */
const SEEDS = [
  `${ORIGIN}/offers-and-rewards`,
  `${ORIGIN}/offers-and-rewards/discount`,
  `${ORIGIN}/offers-and-rewards/emi`,
  `${ORIGIN}/offers-and-rewards/regional-campaigns`,
] as const;

/**
 * Map a tier phrase to a catalogue key.
 *
 * Longest first, because "Platinum Reserve" contains "Platinum" and matching the
 * shorter one would silently widen a Reserve-only offer to every Platinum
 * holder. Order here is load-bearing, not cosmetic.
 */
const TIER_PATTERNS: readonly { pattern: RegExp; key: string }[] = [
  // Visa and Mastercard first: their names contain "Platinum" too, and matching
  // the Amex tier on "CITY BANK VISA PLATINUM" would put a Visa-only offer on
  // every Amex Platinum card.
  { pattern: /visa\s+infinite/i, key: 'citybank_visa_infinite' },
  { pattern: /visa\s+platinum/i, key: 'citybank_visa_platinum' },
  { pattern: /mastercard\s+world\s+elite/i, key: 'citybank_mastercard_world_elite' },
  { pattern: /platinum\s+reserve/i, key: 'citybank_amex_platinum_reserve' },
  { pattern: /\bplatinum\b/i, key: 'citybank_amex_platinum' },
  { pattern: /\bgold\b/i, key: 'citybank_amex_gold' },
  { pattern: /\bblue\b/i, key: 'citybank_amex_blue' },
  { pattern: /\bagora\b/i, key: 'citybank_amex_agora' },
  { pattern: /city\s*alo/i, key: 'citybank_amex_city_alo' },
  { pattern: /\bbiman\b/i, key: 'citybank_amex_biman' },
  { pattern: /university\s+of\s+dhaka|\bdu\s+amex/i, key: 'citybank_amex_du' },
];

/**
 * Which card products a published eligibility sentence names.
 *
 * "CITY BANK VISA PLATINUM" must not match the Amex Platinum pattern, so the
 * network-qualified names are tested first and their match suppresses the bare
 * tier word they contain.
 */
export function cardKeysFrom(eligibilityText: string): { keys: string[]; unmapped: string[] } {
  const text = eligibilityText.toLowerCase();
  const keys: string[] = [];
  const unmapped: string[] = [];

  // Blank out each network-qualified name once matched, so its tier word cannot
  // be matched a second time as an Amex tier.
  let remaining = text;
  for (const { pattern, key } of TIER_PATTERNS) {
    const match = pattern.exec(remaining);
    if (match == null) continue;
    keys.push(key);
    if (key.includes('_visa_') || key.includes('_mastercard_')) {
      remaining = remaining.replace(pattern, ' ');
    }
  }

  // A tier the catalogue still does not cover. Reported rather than discarded:
  // the user may hold exactly that card.
  if (/visa\s+signature|mastercard\s+titanium|visa\s+gold/i.test(text)) {
    unmapped.push(eligibilityText.trim());
  }

  return { keys, unmapped };
}

/**
 * Split one merchant card into its published fields.
 *
 * City Bank labels them explicitly — `NAME:`, `OFFER:`, `CARD ELIGIBILITY:`,
 * `ADDRESS:` — which is a gift, and reading the labels is far more reliable than
 * inferring from position. The first live run took the first line of each block
 * as the merchant and produced 367 offers whose merchant was
 * "OFFER: 10% SAVINGS EXCEPT MOVENPICK ICE CREAM", which is useless for the one
 * thing the catalogue exists to answer: "what applies at *this shop*".
 *
 * The unlabelled fallbacks stay, because the labels are a convention of today's
 * pages rather than a contract.
 */
/**
 * Split the page's text on its own `NAME:` labels.
 *
 * This replaced HTML block segmentation for this source, and the reason is a
 * bug the first live run produced: the markup nests one merchant's card inside
 * a wrapper that also contains the next, so a block sometimes carried two
 * offers. The parser then read the percentage from one and the cap from the
 * other, and emitted "10% SAVINGS ... MAXIMUM BDT 500" as *15% capped at ৳15*.
 *
 * Wrong numbers are worse than no numbers (§2.5): a missing offer is invisible,
 * a fabricated one sends someone to a counter with the wrong card. Splitting on
 * the label the page itself puts before every merchant makes the boundary
 * exact, because it comes from the publisher rather than from a guess about
 * their markup.
 *
 * Returns `null` when the page uses no labels, so the generic heuristic still
 * covers a page that changes convention.
 */
function splitByNameLabel(html: string): { text: string }[] | null {
  const text = htmlToText(html);
  const lines = text.split('\n');

  // Two conventions across the site: the `/discount/*` pages label the merchant
  // `NAME:`, the `/regional-campaign/*` pages label it `Campaign:`. Splitting on
  // only the first left 227 of 342 offers with an offer sentence where the shop
  // name belongs — the regional pages produced merchants called
  // "15% SAVINGS ON THAI & CHINESE FOOD".
  const starts = lines.reduce<number[]>((acc, line, index) => {
    if (/^(name|campaign)\s*:/i.test(line.trim())) acc.push(index);
    return acc;
  }, []);
  if (starts.length < 2) return null;

  return starts.map((start, i) => ({
    text: lines.slice(start, starts[i + 1] ?? lines.length).join('\n'),
  }));
}

type CardFields = {
  name: string;
  offer: string;
  eligibility: string;
  address: string;
  validity: string;
  region: string;
};

function parseCardFields(text: string): CardFields {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const isLabel = (line: string): boolean => /^[a-z ]{3,20}\s*:/i.test(line);

  /**
   * Read one labelled field.
   *
   * The regional pages put the label on its own line and the value on the next
   * — `Offer:` then `15% SAVINGS ON ALL FOOD` — while the discount pages keep
   * both on one line. Taking only the same-line value left every regional
   * offer with an empty benefit, so an empty value falls through to the
   * following line, provided that line is not itself a label.
   */
  const labelled = (label: RegExp): string => {
    const index = lines.findIndex((l) => label.test(l));
    if (index === -1) return '';
    const sameLine = lines[index]!.replace(label, '').replace(/^[:\s-]+/, '').trim();
    if (sameLine !== '') return sameLine;
    const next = lines[index + 1];
    return next != null && !isLabel(next) ? next : '';
  };

  const name = labelled(/^(name|campaign)\s*:/i);
  const offer = labelled(/^offer\s*:/i);
  const eligibility = labelled(/^card\s*eligibility\s*:/i);
  const address = labelled(/^(address|location|outlet)s?\s*:/i);
  const duration = labelled(/^(duration|validity|valid)\s*:/i);

  return {
    // Fall back to the first unlabelled line only — otherwise the fallback
    // reintroduces exactly the bug it is guarding against.
    name: name !== '' ? name : (lines.find((l) => !isLabel(l)) ?? ''),
    offer: offer !== '' ? offer : text,
    eligibility:
      eligibility !== ''
        ? eligibility
        : (lines.find((l) => /credit card|debit card|american express|amex|visa|mastercard/i.test(l)) ?? ''),
    address:
      address !== ''
        ? address
        : (lines.find((l) =>
            /road|avenue|gulshan|dhanmondi|banani|uttara|chattogram|sylhet|dhaka|plot|house|level/i.test(l),
          ) ?? ''),
    validity:
      duration !== ''
        ? duration
        : (lines.find((l) => /valid|until|till|expires?|weekend|friday|saturday|\d{1,2}\s+\w+\s+20\d\d/i.test(l)) ??
          ''),
    region: labelled(/^region\s*:/i),
  };
}

/**
 * The image-grid pages: BOGO and EMI.
 *
 * `/bogo`, `/emi/electronics` and `/emi/furniture` are galleries. Their cards
 * carry a picture and the words "View details" and nothing else — no money, no
 * labels — so both the label splitter and the money-seeking block heuristic
 * come back empty, which is why these four pages produced zero offers while
 * every other page worked.
 *
 * The merchant name is in the image *filename*:
 *
 *     /assets/bogo/CROWNE_PLAZA_DHAKA_AIRPORT.jpg  →  Crowne Plaza Dhaka Airport
 *
 * That is more reliable here than the visible headings, which interleave shop
 * names with offer labels ("AMAYA", "BUY ONE GET ONE", "MOSAIC") in an order
 * that cannot be paired up without guessing.
 *
 * Scoped to the page's own asset folder so navigation icons, the bank's logo
 * and social badges cannot become merchants.
 */
export function extractImageGrid(html: string, assetFolder: string, exclude: readonly string[] = []): string[] {
  const pattern = new RegExp(`/assets/${assetFolder}/([^"'/?]+)\\.(?:jpe?g|png|webp)`, 'gi');
  const names = new Set<string>();
  const excluded = new Set(exclude.map((word) => word.toLowerCase()));

  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (raw == null) continue;

    const name = decodeURIComponent(raw)
      // The EMI galleries prefix every file with an upload timestamp:
      // `1784028223_Best_Electronics_Limited.jpg`. Left in, every merchant is
      // named after the second it was uploaded.
      .replace(/^\d{6,}[_-]*/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (name === '' || name.length < 2) continue;
    if (/^(citylogo|logo|favicon|banner|icon|placeholder)$/i.test(name)) continue;
    // A file named after the page's own section is the section banner, not a
    // shop — "Electronics" on the electronics page.
    if (excluded.has(name.toLowerCase())) continue;
    // Whatever is left after stripping the timestamp has to contain a letter.
    if (!/\p{L}/u.test(name)) continue;

    names.add(titleCase(name));
  }

  return [...names];
}

/** "CROWNE_PLAZA_DHAKA" reads as shouting; "Crowne Plaza Dhaka" reads as a shop. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) => (word.length <= 3 && /^(ltd|and|the|of)$/i.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/** Which asset folder a gallery page keeps its merchant images in. */
function assetFolderFor(url: string): string | null {
  const path = new URL(url).pathname;
  if (path.endsWith('/bogo')) return 'bogo';
  if (path.includes('/emi/')) return 'emi';
  if (path.endsWith('/emi')) return 'emi';
  return null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Read a campaign window like "25th JUNE-30th SEPTEMBER, 2026".
 *
 * Worth doing rather than leaving blank: an offer with no end date can never be
 * marked expired, so a campaign that finished in September would keep being
 * recommended in December with a confident "Verified" badge. A parsed end date
 * is what lets the confidence layer retire it on its own.
 *
 * Returns nulls rather than guessing. A campaign whose dates cannot be read is
 * open-ended and gets flagged stale by age instead, which is the safe failure.
 */
export function parseDuration(raw: string): { from: string | null; till: string | null } {
  const text = raw.toLowerCase().replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const year = /\b(20\d{2})\b/.exec(text)?.[1];
  if (year == null) return { from: null, till: null };

  const points = [...text.matchAll(/(\d{1,2})\s*([a-z]{3,9})/g)]
    .map((match) => ({ day: Number(match[1]), month: MONTHS[match[2]!.slice(0, 3)] }))
    .filter((point): point is { day: number; month: number } => point.month != null);

  if (points.length === 0) return { from: null, till: null };

  const iso = (point: { day: number; month: number }, y: number): string =>
    `${String(y)}-${String(point.month).padStart(2, '0')}-${String(point.day).padStart(2, '0')}T00:00:00.000Z`;

  const start = points[0]!;
  const end = points[1] ?? null;
  const startYear = Number(year);
  // A window that runs backwards crossed a new year: "25 DEC – 5 JAN, 2026".
  const endYear = end != null && end.month < start.month ? startYear + 1 : startYear;

  return {
    from: iso(start, startYear),
    // An end date is the useful half; a campaign with only one date stated is
    // treated as open-ended rather than as ending on its start day.
    till: end == null ? null : iso(end, endYear),
  };
}

/** The category a discovered URL belongs to, read from its own path. */
function categoryFromUrl(url: string): string {
  const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  return segment.replace(/-offers?$/, '').replace(/-/g, ' ');
}

export const cityBankAdapter: OfferSourceAdapter = {
  key: 'citybank_web',
  displayName: 'City Bank offers and rewards',
  provider: 'citybank',
  instrument: 'credit_card',
  termsUrl: `${ORIGIN}/terms-and-conditions`,
  seeds: SEEDS,

  async collect(context: AdapterContext): Promise<AdapterResult> {
    const offers: RawOffer[] = [];
    const warnings: string[] = [];
    const visited = new Set<string>();
    let pagesFetched = 0;

    // Breadth-first from the hubs. Only paths under /offers-and-rewards/ are
    // followed, so a stray link into the rest of the site cannot turn this into
    // a crawl of the whole bank.
    const queue: string[] = [...SEEDS];

    while (queue.length > 0 && pagesFetched < context.maxPages) {
      const url = queue.shift();
      if (url == null || visited.has(url)) continue;
      visited.add(url);

      const page = await context.fetchPage(url);
      pagesFetched += 1;

      if (page.notModified) {
        context.log(`unchanged: ${url}`);
        continue;
      }
      if (!page.ok || page.body === '') {
        warnings.push(`${url}: ${page.problem ?? 'empty response'}`);
        continue;
      }

      // Layer 1 first — if the bank ever publishes JSON-LD, it beats guessing.
      const structured = offerNodes(extractJsonLd(page.body));
      for (const node of structured) {
        const merchant = stringField(node, 'name') ?? stringField(node, 'seller') ?? '';
        const description = stringField(node, 'description') ?? '';
        if (merchant === '' && description === '') continue;
        offers.push({
          merchant,
          categoryLabel: stringField(node, 'category') ?? categoryFromUrl(url),
          title: merchant === '' ? description.slice(0, 80) : merchant,
          description,
          eligibilityText: description,
          locationText: stringField(node, 'areaServed') ?? '',
          validityText: stringField(node, 'validThrough') ?? '',
          sourceUrl: url,
        });
      }

      // Layer 3 — the floor, and in practice the layer that does the work here.
      if (structured.length === 0) {
        const blocks = splitByNameLabel(page.body) ?? extractRepeatedBlocks(page.body);
        for (const block of blocks) {
          const fields = parseCardFields(block.text);
          if (fields.name === '') continue;

          const { unmapped } = cardKeysFrom(fields.eligibility);
          for (const tier of unmapped) {
            warnings.push(`unmapped card tier on ${url}: "${tier.slice(0, 90)}"`);
          }

          offers.push({
            merchant: fields.name,
            categoryLabel: categoryFromUrl(url),
            // The offer line is the headline; the whole block is what the parser
            // reads, because caps and minimums live in the lines below it.
            title: fields.offer.slice(0, 140),
            description: block.text,
            eligibilityText: fields.eligibility,
            // The regional pages state the city outright, which beats guessing
            // it from a street address.
            locationText: fields.region !== '' ? fields.region : fields.address,
            validityText: fields.validity,
            sourceUrl: url,
          });
        }

        // The gallery pages: no labels, no money, just pictures of merchants.
        const folder = assetFolderFor(url);
        if (blocks.length === 0 && folder != null) {
          const isBogo = folder === 'bogo';
          const section = categoryFromUrl(url);
          const merchants = extractImageGrid(page.body, folder, [section, 'electronics', 'furniture', 'emi', 'bogo']);

          for (const merchant of merchants) {
            offers.push({
              merchant,
              categoryLabel: isBogo ? 'Dining' : categoryFromUrl(url),
              title: isBogo ? 'Buy one get one' : '0% EMI',
              // The parser reads this. "Buy one get one" resolves to a bogo
              // benefit; the EMI line yields no discount at all, which is
              // correct — interest-free instalments change *when* you pay, not
              // what it costs, and claiming a saving would be a lie.
              description: isBogo
                ? 'BUY ONE GET ONE on selected items with City Bank cards.'
                : '0% interest EMI available with City Bank cards, up to 24 months.',
              eligibilityText: 'CITY BANK CARDS',
              locationText: '',
              validityText: '',
              sourceUrl: url,
            });
          }

          if (merchants.length > 0) {
            context.log(`${url}: ${String(merchants.length)} merchants from the image grid`);
          }
        }

        if (blocks.length === 0 && folder == null) {
          // Worth a warning: it usually means the page moved to client-side
          // rendering, and a silent zero would read as "no offers this month".
          const visible = htmlToText(page.body);
          warnings.push(
            visible.length < 500
              ? `${url}: page rendered almost no text — likely client-side rendered now`
              : `${url}: no offer-shaped blocks found in ${String(visible.length)} characters of text`,
          );
        }
      }

      // Queue sibling category pages found on this one.
      for (const link of sameOriginLinks(page.body, url)) {
        if (!link.includes('/offers-and-rewards/')) continue;
        if (!isCrawlableDocument(link)) continue;
        if (visited.has(link) || queue.includes(link)) continue;
        queue.push(link);
      }
    }

    if (pagesFetched >= context.maxPages && queue.length > 0) {
      // §"No silent caps": say what was left, rather than reporting a partial
      // catalogue as a complete one.
      warnings.push(`page budget reached — ${String(queue.length)} discovered pages not fetched this run`);
    }

    return { offers, pagesFetched, warnings };
  },
};

/**
 * Is this link a page, or is it a stylesheet the crawler has no business
 * fetching?
 *
 * The first live run spent eleven of its forty page slots on CSS and favicons,
 * one of which was 465 KB of icon-font declarations that the block extractor
 * then dutifully searched for offers. Two filters fix it: refuse anything with
 * an asset extension, and refuse the site's own unrendered template
 * placeholders — the page ships literal `${item.url}` hrefs, which resolve to
 * URL-encoded 404s.
 */
function isCrawlableDocument(link: string): boolean {
  if (link.includes('$%7B') || link.includes('${')) return false;
  const path = new URL(link).pathname.toLowerCase();
  return !/\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip|mp4|webm)$/.test(path);
}

function stringField(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  if (typeof value === 'string') return value;
  if (value != null && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return null;
}
