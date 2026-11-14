/**
 * Structure-agnostic extraction.
 *
 * §2 of the brief: "Do not hard-code the system around the current HTML
 * structure of these websites." A selector like `.offer-card__title` works
 * until the marketing team ships a redesign, and then the collector returns
 * zero offers silently — which is the worst possible failure, because an empty
 * catalogue looks exactly like "there are no offers this month".
 *
 * So extraction runs in layers, best first, and each layer is independent of the
 * page's cosmetic markup:
 *
 *  1. **JSON-LD** (`<script type="application/ld+json">`). Structured, typed,
 *     and put there deliberately for machines. When present it is authoritative.
 *  2. **Embedded application state** — `__NEXT_DATA__` and the handful of other
 *     conventional globals. Framework-generated, so it survives visual
 *     redesigns; it changes only when the data model does.
 *  3. **Repeated-block heuristic.** Find the sibling groups that repeat with
 *     similar shape and contain a money or percent token, and take their text.
 *     This knows nothing about class names and survives a redesign, which is
 *     precisely why it is the floor rather than the ceiling.
 *
 * Every layer yields *text*. Turning text into structure is the normalisation
 * stage's job and is shared across all sources.
 *
 * No DOM library: this runs on plain Node with no dependencies, and the three
 * strategies above need tokenisation rather than a full parse. The regexes are
 * deliberately simple and are never asked to do nesting.
 */

/** A candidate offer: a contiguous run of text the page presented as one unit. */
export type TextBlock = {
  text: string;
  /** Which layer produced it, for the run report. */
  via: 'json-ld' | 'embedded-state' | 'repeated-block';
  /** Any link the block contained, useful for following through to detail pages. */
  href: string | null;
};

// ─── Layer 1: JSON-LD ────────────────────────────────────────────────────────

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (raw == null) continue;
    try {
      const parsed: unknown = JSON.parse(raw.trim());
      // A `@graph` wrapper is common and holds the interesting nodes.
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed != null && typeof parsed === 'object' && '@graph' in parsed) {
        const graph = (parsed as { '@graph': unknown })['@graph'];
        if (Array.isArray(graph)) out.push(...graph);
        else out.push(parsed);
      } else out.push(parsed);
    } catch {
      // Malformed JSON-LD is common enough not to be worth reporting. The next
      // layer will pick the page up.
    }
  }
  return out;
}

/** JSON-LD nodes whose `@type` says they describe an offer or a product with one. */
export function offerNodes(nodes: readonly unknown[]): Record<string, unknown>[] {
  const wanted = new Set(['offer', 'aggregateoffer', 'product', 'discount', 'saleevent', 'specialannouncement']);
  return nodes.filter((node): node is Record<string, unknown> => {
    if (node == null || typeof node !== 'object') return false;
    const type = (node as { '@type'?: unknown })['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.some((t) => typeof t === 'string' && wanted.has(t.toLowerCase()));
  });
}

// ─── Layer 2: embedded application state ─────────────────────────────────────

/**
 * The conventional places a framework parks its server-rendered data.
 *
 * Listed rather than pattern-matched: a greedy search for any large JSON blob
 * finds analytics payloads and consent-manager configuration, and mining those
 * for "offers" produces confident nonsense.
 */
const STATE_PATTERNS: readonly RegExp[] = [
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  /<script[^>]*>\s*window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
  /<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
];

export function extractEmbeddedState(html: string): unknown | null {
  for (const pattern of STATE_PATTERNS) {
    const match = pattern.exec(html);
    if (match?.[1] == null) continue;
    try {
      return JSON.parse(match[1].trim()) as unknown;
    } catch {
      continue;
    }
  }

  const flight = decodeRscFlight(html);
  return flight.length > 0 ? flight : null;
}

/**
 * Decode a React Server Components flight payload.
 *
 * Modern Next.js apps no longer ship `__NEXT_DATA__`. They stream the rendered
 * tree as a sequence of `self.__next_f.push([1, "<chunk>"])` calls whose
 * concatenated chunks form a line-oriented format:
 *
 *     <hexid>:<json>
 *     <hexid>:T<hexlength>,<raw text>
 *
 * The server-rendered props — which is where an offer list lives — sit inside
 * the JSON rows. Reading them is worth the effort because it is the *data* the
 * page was built from rather than the markup it was rendered into: it survives
 * a redesign completely, and it carries fields the visible page never shows,
 * such as validity dates and coupon codes.
 *
 * Rows that do not parse are skipped without complaint. A streamed payload is
 * legitimately full of partial rows, component references and `$`-prefixed
 * placeholders, and none of them are errors.
 */
export function decodeRscFlight(html: string): unknown[] {
  const pushPattern = new RegExp('self\\.__next_f\\.push\\(\\[1,"((?:[^"\\\\]|\\\\.)*)"\\]\\)', 'g');

  const chunks: string[] = [];
  for (const match of html.matchAll(pushPattern)) {
    if (match[1] == null) continue;
    try {
      chunks.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      continue;
    }
  }
  if (chunks.length === 0) return [];

  const flight = chunks.join('');
  const rows: unknown[] = [];

  for (const row of flight.split(/\n(?=[0-9a-f]+:)/i)) {
    const separator = row.indexOf(':');
    if (separator === -1) continue;
    const body = row.slice(separator + 1);
    if (body[0] !== '{' && body[0] !== '[') continue;
    try {
      rows.push(JSON.parse(body) as unknown);
    } catch {
      continue;
    }
  }
  return rows;
}

/**
 * Walk an arbitrary object graph collecting every node that looks like an offer.
 *
 * "Looks like" means: an object carrying at least two of the fields an offer
 * always has — a merchant-ish name, a discount-ish number, a validity, a
 * category. Two rather than one, because a single `title` field describes half
 * the nodes in any page's state tree.
 */
export function findOfferLikeNodes(root: unknown, limit = 500): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];

  const NAME_KEYS = ['merchant', 'merchantname', 'partner', 'outlet', 'brand', 'title', 'name', 'shopname'];
  const VALUE_KEYS = ['discount', 'discountpercentage', 'cashback', 'offer', 'savings', 'percentage', 'benefit'];
  const META_KEYS = ['category', 'validtill', 'validfrom', 'enddate', 'startdate', 'cardtype', 'terms', 'location'];

  while (queue.length > 0 && found.length < limit) {
    const node = queue.shift();
    if (node == null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const record = node as Record<string, unknown>;
    const keys = Object.keys(record).map((k) => k.toLowerCase().replace(/[^a-z]/g, ''));

    const signals =
      Number(keys.some((k) => NAME_KEYS.includes(k))) +
      Number(keys.some((k) => VALUE_KEYS.includes(k))) +
      Number(keys.some((k) => META_KEYS.includes(k)));

    if (signals >= 2) found.push(record);
    queue.push(...Object.values(record));
  }

  return found;
}

// ─── Layer 3: repeated blocks ────────────────────────────────────────────────

/** Tags whose contents are never page copy. */
const NOISE = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Strip markup to readable text, preserving block boundaries as newlines. */
export function htmlToText(html: string): string {
  return html
    .replace(NOISE, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** A block has to say something about money to be a candidate. */
// A block is worth reading if it mentions money — or a buy-one-get-one,
// which is a real offer that carries no figure at all and was otherwise
// filtered out before the normaliser ever saw it.
const MONEY_SIGNAL = /(\d+\s*%)|(৳|bdt|tk\.?|taka|টাকা)\s*[\d০-৯]|buy one get one|bogo/i;

/**
 * Split a page into repeated candidate blocks.
 *
 * The heuristic: any element that repeats as a sibling and whose text contains a
 * money or percent token is probably one entry in a list of offers. The tag name
 * is used only to segment; no class name is consulted, which is what makes this
 * survive a redesign.
 *
 * Blocks are size-bounded at both ends. Too short and it is a price on a
 * navigation chip; too long and it is the whole page including the footer, which
 * would hand the term parser a document containing every number on the site.
 */
export function extractRepeatedBlocks(html: string, options: { minChars?: number; maxChars?: number } = {}): TextBlock[] {
  const minChars = options.minChars ?? 40;
  const maxChars = options.maxChars ?? 1_200;
  const cleaned = html.replace(NOISE, ' ');

  const blocks: TextBlock[] = [];
  const seen = new Set<string>();

  // Segment on the container tags a list of cards is realistically built from.
  for (const tag of ['li', 'article', 'tr', 'div', 'section']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const candidates: TextBlock[] = [];

    for (const match of cleaned.matchAll(pattern)) {
      const inner = match[1] ?? '';
      const text = htmlToText(inner);
      if (text.length < minChars || text.length > maxChars) continue;
      if (!MONEY_SIGNAL.test(text)) continue;

      const key = text.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({ text, via: 'repeated-block', href: firstHref(inner) });
    }

    // A single match is not a repetition; it is usually the page wrapper that
    // happens to contain one price. Two is the floor for calling it a list.
    if (candidates.length >= 2) blocks.push(...candidates);
  }

  return dropContainers(blocks);
}

/**
 * Remove blocks that merely contain other blocks.
 *
 * Nested segmentation means the same offer surfaces once as a `<li>` and again
 * as the `<div>` wrapping all of them. Keeping the outer one would feed the
 * parser a concatenation of six offers and produce one wrong row from it.
 */
function dropContainers(blocks: readonly TextBlock[]): TextBlock[] {
  const sorted = [...blocks].sort((a, b) => a.text.length - b.text.length);
  const kept: TextBlock[] = [];

  for (const block of sorted) {
    const containsAnother = kept.some((k) => block.text.includes(k.text) && block.text.length > k.text.length * 1.4);
    if (!containsAnother) kept.push(block);
  }
  return kept;
}

function firstHref(html: string): string | null {
  return /href=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
}

/** Absolute links on a page, deduplicated and filtered to the same origin. */
export function sameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Set<string>();

  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = match[1];
    if (href == null || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.origin === base.origin) out.add(resolved.toString());
    } catch {
      continue;
    }
  }
  return [...out];
}
