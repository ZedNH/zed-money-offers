/**
 * Offer normalisation (§6).
 *
 * Sources describe the same promotion in incompatible prose. Offer Finder writes
 * "10% discount, up to Tk 500, on a minimum purchase of Tk 2,500"; a bank writes
 * "Enjoy 10% savings (max. BDT 500) on transactions of BDT 2,500 and above";
 * a Bangla page writes "১০% ছাড়, সর্বোচ্চ ৫০০ টাকা". All three mean:
 *
 *     { discountType: 'percentage', discountValue: 10,
 *       maximumDiscount: 50000, minimumTransaction: 250000 }
 *
 * Only once they are the same shape can the engine compare them arithmetically,
 * which is the entire premise of ranking by final cost.
 *
 * The parser is deliberately **conservative**: an unrecognised phrase yields
 * `null`, not a guess. A wrong cap silently makes an offer look better than it
 * is, and the user finds out at the counter (§2.8, §2.5).
 *
 * Pure: text in, structure out. No clock, no network.
 */

import { toAsciiDigits, type Paisa } from '../money.ts';
import type { OfferCategoryKey } from '../types.ts';

export type ParsedTerms = {
  /** Percent, 0–100. `null` when the text does not state one. */
  percent: number | null;
  /** A flat benefit in paisa, e.g. "৳200 cashback". */
  flatBenefit: Paisa | null;
  /** Benefit ceiling in paisa. `null` means the text stated no cap, not "uncapped". */
  maxBenefit: Paisa | null;
  minSpend: Paisa | null;
  maxSpend: Paisa | null;
  mode: 'discount' | 'cashback' | null;
  /**
   * True when the only figure found was a ceiling — "up to ৳200", with no
   * percentage to apply it to. The offer is then worth *at most* that, and
   * quoting it as a guaranteed saving would overstate every small basket.
   */
  benefitIsUpperBound: boolean;
  /** EMI tenures the text mentions, in months. */
  emiTenures: number[];
  interestFreeEmi: boolean;
  promoCode: string | null;
  /** Phrases the parser recognised, for debugging an adapter. */
  matched: string[];
};

/** Currency written every way a Bangladeshi page writes it. */
const CURRENCY = '(?:৳|tk\\.?|bdt|taka|টাকা)';
/** A number with optional thousands separators and decimals, ASCII or Bengali digits. */
const NUMBER = '([\\d\\u09E6-\\u09EF][\\d\\u09E6-\\u09EF,\\.]*)';

/**
 * Parse a money figure to paisa.
 *
 * Accepts "1,500", "1500.50", "১৫০০" and the lakh/thousand suffixes that appear
 * in campaign copy. Returns `null` rather than 0 for unparseable input, because
 * 0 is a meaningful value here — "no minimum" — and must not be confused with
 * "we could not read it".
 */
export function parseMoney(raw: string): Paisa | null {
  const text = toAsciiDigits(raw).trim().toLowerCase();
  const match = /([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|lac|lakhs|crore)?/.exec(text);
  if (match?.[1] == null) return null;

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const multiplier =
    match[2] === 'k' || match[2] === 'thousand'
      ? 1_000
      : match[2] === 'lakh' || match[2] === 'lac' || match[2] === 'lakhs'
        ? 100_000
        : match[2] === 'crore'
          ? 10_000_000
          : 1;

  // Money is integer paisa (§2.1). Rounded once, here, at the boundary.
  return Math.round(value * multiplier * 100);
}

/**
 * First money figure matching any pattern — with one hard rule.
 *
 * A number immediately followed by `%` is a **percentage, not an amount**.
 * "UP TO 25% SAVINGS" was being read as a ৳25 benefit cap, which silently
 * capped a 25% discount at twenty-five taka. The check lives here rather than
 * in each pattern because every money pattern needs it and only one of them
 * would have been remembered.
 */
function firstMoney(text: string, patterns: readonly RegExp[], matched: string[]): Paisa | null {
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found?.[1] == null) continue;

    const after = text.slice(found.index + found[0].length);
    if (/^\s*%/.test(after)) continue;

    matched.push(found[0].trim());
    return parseMoney(found[1]);
  }
  return null;
}

/**
 * Pull structured terms out of an offer's prose.
 *
 * Every pattern below is a phrasing observed on a real Bangladeshi offer page.
 * The list grows by adding a pattern, never by loosening one — a greedy pattern
 * that matches the wrong number is worse than one that matches nothing, because
 * nothing is visible and wrong is not.
 */
export function parseTerms(raw: string): ParsedTerms {
  const text = toAsciiDigits(raw).toLowerCase().replace(/\s+/g, ' ');
  const matched: string[] = [];

  const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  const percent = percentMatch?.[1] != null ? Number(percentMatch[1]) : null;
  if (percentMatch != null) matched.push(percentMatch[0]);

  const maxBenefit = firstMoney(
    text,
    [
      new RegExp(`(?:max(?:imum)?|up ?to|upto|highest|সর্বোচ্চ)(?![\\p{L}])[^\\d৳]{0,20}${CURRENCY}?\\s*${NUMBER}`, 'iu'),
      // "MAXIMUM SAVINGS PER TRANSACTION & PER DAY SHALL NOT EXCEED TO BDT. 1000"
      // — forty characters between the qualifier and the figure, so the tight
      // window above misses it, and a cap read as uncapped overstates every
      // large bill.
      new RegExp(`(?:shall not exceed|not exceed|capped at)[^\\d৳]{0,25}${CURRENCY}?\\s*${NUMBER}`, 'i'),
      new RegExp(`${CURRENCY}\\s*${NUMBER}[^.]{0,15}(?:max(?:imum)?|cap)`, 'i'),
    ],
    matched,
  );

  const minSpend = firstMoney(
    text,
    [
      // `min` has to be a whole word. Without the lookahead it matched inside
      // "1 MINTO ROAD, RAMNA, DHAKA … 01713082283" and read the shop's phone
      // number as a ৳1,713,082,283 minimum spend.
      new RegExp(
        `(?:min(?:imum)?|at least|ন্যূনতম)(?![\\p{L}])[^\\d৳]{0,30}(?:purchase|transaction|spend|bill|amount)?[^\\d৳]{0,10}${CURRENCY}?\\s*${NUMBER}`,
        'iu',
      ),
      new RegExp(`${CURRENCY}\\s*${NUMBER}\\s*(?:and above|or more|\\+)`, 'i'),
    ],
    matched,
  );

  const maxSpend = firstMoney(
    text,
    [new RegExp(`(?:valid )?(?:up ?to|upto) (?:a )?(?:purchase|transaction|bill) of ${CURRENCY}?\\s*${NUMBER}`, 'i')],
    matched,
  );

  // A flat benefit only counts when no percentage was stated. "10% up to ৳500"
  // has a cap, not a flat benefit, and reading the 500 as flat would turn a
  // capped percentage into a guaranteed payout.
  const flatBenefit =
    percent != null
      ? null
      : firstMoney(
          text,
          [
            new RegExp(`${CURRENCY}\\s*${NUMBER}\\s*(?:cashback|cash back|discount|off|ছাড়)`, 'i'),
            new RegExp(`(?:flat|save|get)\\s*${CURRENCY}?\\s*${NUMBER}\\s*(?:cashback|off|discount)?`, 'i'),
          ],
          matched,
        );

  // A ceiling and no percentage means the figure is a bound, not a benefit.
  //
  // The `flatBenefit === maxBenefit` arm is the one that matters in practice:
  // "Up to BDT 200 Discount" matches *both* the ceiling pattern and the flat
  // pattern, on the same number. Without this the app would promise ৳200 off a
  // ৳300 basket when the terms only ever said "up to".
  const benefitIsUpperBound =
    percent == null && maxBenefit != null && (flatBenefit == null || flatBenefit === maxBenefit);

  const isCashback = /cash ?back|ক্যাশব্যাক/.test(text);
  const isDiscount = /discount|off\b|savings?|ছাড়/.test(text);
  const mode = isCashback ? 'cashback' : isDiscount ? 'discount' : null;
  if (mode != null) matched.push(mode);

  const emiTenures = [...text.matchAll(/(\d{1,2})\s*(?:-|\s)?months?\s*emi|emi\s*(?:up ?to\s*)?(\d{1,2})\s*months?/g)]
    .map((m) => Number(m[1] ?? m[2]))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);

  const interestFreeEmi = /0%\s*(?:interest|emi)|interest[- ]free|zero[- ]interest/.test(text);

  // Two characters, not three. bKash's coupon codes are things like `D2` and
  // `D5`, and a three-character floor silently dropped the code from nearly
  // twenty thousand offers — leaving the app to recommend a discount that does
  // not apply unless something it never showed you is typed at checkout.
  const codeMatch = /(?:promo|coupon|voucher)\s*code[:\s]*([a-z0-9_-]{2,20})/i.exec(raw);
  const promoCode = codeMatch?.[1]?.toUpperCase() ?? null;
  if (promoCode != null) matched.push(`code ${promoCode}`);

  return {
    percent,
    // With no percentage to apply it to, the ceiling *is* the figure — flagged
    // as a bound so the engine can label it rather than promise it.
    flatBenefit: benefitIsUpperBound ? maxBenefit : flatBenefit,
    maxBenefit,
    minSpend,
    maxSpend,
    mode,
    benefitIsUpperBound,
    emiTenures: [...new Set(emiTenures)].sort((a, b) => a - b),
    interestFreeEmi,
    promoCode,
    matched,
  };
}

/**
 * Map a source's own category word onto ours.
 *
 * Offer Finder and City Bank use different vocabularies for the same shelf
 * ("Food & Beverage" vs "Dining", "Lifestyle" vs "Fashion"). Unrecognised words
 * become `other` rather than being forced into the nearest bucket — an offer
 * filed under the wrong category is recommended at the wrong counter (§11.3).
 */
const CATEGORY_SYNONYMS: readonly [OfferCategoryKey, readonly string[]][] = [
  ['grocery', ['grocery', 'groceries', 'super shop', 'supershop', 'superstore', 'departmental', 'daily needs']],
  [
    'restaurant',
    [
      'restaurant', 'dining', 'food & beverage', 'food and beverage', 'f&b', 'cafe', 'café', 'coffee', 'buffet',
      // Phrases lifted from offer copy rather than category labels. City Bank's
      // regional pages file everything under a city name, so the shelf has to
      // come from the offer sentence — "15% SAVINGS ON ALL FOOD" is a
      // restaurant, and without these it lands in `other` where "I want dinner"
      // can never reach it.
      'all food', 'a la carte', 'à la carte', 'set menu', 'full menu', 'on food', 'kabab', 'kebab', 'biryani',
      'biriyani', 'grill', 'pizza', 'burger', 'bakery', 'dessert', 'ice cream',
    ],
  ],
  ['food_delivery', ['food delivery', 'online food', 'delivery']],
  ['fashion', ['fashion', 'lifestyle', 'clothing', 'apparel', 'footwear', 'jewellery', 'jewelry']],
  ['electronics', ['electronics', 'gadget', 'mobile phone', 'appliance', 'computer', 'it product']],
  ['pharmacy', ['pharmacy', 'pharma', 'medicine', 'chemist']],
  ['health', ['health', 'healthcare', 'hospital', 'diagnostic', 'clinic', 'dental', 'fitness', 'gym']],
  ['fuel', ['fuel', 'petrol', 'filling station', 'cng']],
  ['ride_share', ['ride', 'ride share', 'ride-sharing', 'transport']],
  ['travel', ['travel', 'hotel', 'resort', 'airline', 'air ticket', 'tour', 'holiday']],
  ['utility_bill', ['utility', 'bill pay', 'electricity', 'gas bill', 'water bill']],
  ['mobile_recharge', ['recharge', 'mobile recharge', 'top up', 'topup', 'airtime']],
  ['education', ['education', 'school', 'university', 'tuition', 'course', 'coaching']],
  ['entertainment', ['entertainment', 'cinema', 'movie', 'theme park', 'streaming']],
  ['ecommerce', ['ecommerce', 'e-commerce', 'online shopping', 'online store', 'marketplace']],
];

export function normaliseCategory(raw: string): OfferCategoryKey {
  const text = raw.trim().toLowerCase();
  if (text === '') return 'other';
  for (const [key, words] of CATEGORY_SYNONYMS) {
    if (words.some((w) => text.includes(w))) return key;
  }
  return 'other';
}

/**
 * A stable identity for an offer across ingestion runs.
 *
 * Without this, re-reading a source every night would either duplicate every
 * campaign or require deleting and re-inserting the catalogue, which would
 * destroy the history §16 depends on. The key deliberately excludes dates and
 * prose: a campaign whose end date is extended is the *same* campaign, and its
 * row should be updated rather than forked.
 */
export function dedupeKeyFor(parts: {
  sourceKey: string;
  provider: string;
  merchant: string;
  category: string;
  benefitType: string;
  value: number;
}): string {
  const slug = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');

  return [
    slug(parts.sourceKey),
    slug(parts.provider),
    slug(parts.merchant) || 'any',
    slug(parts.category),
    parts.benefitType,
    String(parts.value),
  ].join(':');
}

/**
 * Are these two rows, from different sources, the same promotion?
 *
 * Cross-source duplicates are common — a bKash campaign at Shwapno appears on
 * Offer Finder *and* on bKash's own page — and showing it twice makes the
 * catalogue look padded and the comparison look rigged.
 */
export function looksLikeDuplicate(
  a: { provider: string; merchants: readonly string[]; benefitType: string; value: number; category: string },
  b: { provider: string; merchants: readonly string[]; benefitType: string; value: number; category: string },
): boolean {
  if (a.provider !== b.provider) return false;
  if (a.benefitType !== b.benefitType) return false;
  if (a.value !== b.value) return false;
  if (a.category !== b.category) return false;

  // Category-wide offers with no named merchant collide only with each other.
  if (a.merchants.length === 0 || b.merchants.length === 0) {
    return a.merchants.length === b.merchants.length;
  }

  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return a.merchants.some((x) => b.merchants.some((y) => norm(x) === norm(y)));
}
