/**
 * The offer catalogue: resolving a shop to a category, and the seed rows the
 * app ships with.
 *
 * §11.3 is the rule that shapes this file: **never guess a category.** A grocery
 * cashback recommended at a pharmacy counter is not a small error — the user
 * pays with the wrong card and loses real money. So `categoriseShop` returns
 * `null` when it does not know, the UI asks, and the answer is remembered
 * forever (§18.5).
 *
 * Pure.
 */

import { resolveMerchant } from '../merchants.ts';
import type { IsoInstant } from '../time.ts';
import type { Offer, OfferCategoryKey, ProviderKey } from '../types.ts';

/**
 * Resolve a typed shop name to a category.
 *
 * Three sources in strict order: what the user has corrected before, the
 * merchant directory, then keyword fallback. The user's own memory wins because
 * they know their neighbourhood better than a hard-coded list does.
 */
export function categoriseShop(
  shopName: string,
  learned: ReadonlyMap<string, OfferCategoryKey> = new Map(),
): OfferCategoryKey | null {
  const needle = shopName.trim().toLowerCase();
  if (needle === '') return null;

  const remembered = learned.get(needle);
  if (remembered != null) return remembered;

  const known = resolveMerchant(shopName, learned);
  if (known != null) return known.category;

  for (const [category, words] of SHOP_KEYWORDS) {
    if (words.some((word) => needle.includes(word))) return category;
  }
  return null;
}

const SHOP_KEYWORDS: readonly [OfferCategoryKey, readonly string[]][] = [
  ['grocery', ['grocery', 'bazar', 'bazaar', 'super shop', 'supershop', 'departmental']],
  ['restaurant', ['restaurant', 'cafe', 'coffee', 'kabab', 'kebab', 'biryani', 'biriyani', 'dine', 'buffet', 'bakery']],
  ['food_delivery', ['food delivery', 'foodpanda', 'hungrynaki']],
  ['pharmacy', ['pharma', 'medicine', 'chemist', 'pharmacy']],
  ['fashion', ['clothing', 'fashion', 'boutique', 'apparel', 'footwear', 'shoe', 'jewel']],
  ['electronics', ['electronics', 'gadget', 'computer', 'laptop', 'mobile shop']],
  ['fuel', ['petrol', 'fuel', 'octane', 'filling station', 'cng']],
  ['ride_share', ['ride', 'taxi', 'cab']],
  ['travel', ['hotel', 'airlines', 'resort', 'travel', 'tour', 'air ticket']],
  ['mobile_recharge', ['recharge', 'flexiload', 'top up', 'topup']],
  ['utility_bill', ['electricity bill', 'gas bill', 'water bill', 'palli bidyut', 'nesco']],
  ['ecommerce', ['online shop', 'e-commerce', 'ecommerce', 'marketplace']],
  ['entertainment', ['cinema', 'cineplex', 'theatre', 'theme park']],
  ['health', ['hospital', 'diagnostic', 'clinic', 'dental', 'gym', 'fitness']],
  ['education', ['school', 'college', 'university', 'coaching', 'academy']],
];

// ─── Seeded samples (§2.8) ───────────────────────────────────────────────────

export type OfferSeed = Omit<Offer, 'id' | 'createdAt' | 'updatedAt' | 'source'>;

const SAMPLE_SOURCE = {
  sourceKey: 'sample',
  sourceName: 'Worked example shipped with ZED',
} as const;

/**
 * Sample offers.
 *
 * Every row is `isSample: true` and the UI badges it as such. These exist so a
 * new user can see what the payment advisor *does* before any real catalogue has
 * been ingested — the numbers are illustrative, the arithmetic they drive is
 * real, and nothing here is presented as a live promotion. Shipping invented
 * promotions as facts is exactly what §2.8 forbids.
 */
export const SAMPLE_OFFERS: readonly OfferSeed[] = [
  {
    provider: 'bkash', instrument: 'mfs', category: 'grocery', mode: 'cashback', benefitType: 'percent',
    value: 10, maxBenefit: 30_000, minSpend: 100_000,
    title: '10% cashback at super shops', merchants: [], payWith: 'bKash app → Scan QR',
    terms: 'Sample template — check the bKash app for live offers.', isSample: true,
    eligibility: { rails: ['qr', 'app'] }, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'bkash', instrument: 'mfs', category: 'restaurant', mode: 'discount', benefitType: 'percent',
    value: 15, maxBenefit: 30_000, minSpend: 50_000,
    title: '15% off at restaurants', merchants: [], payWith: 'bKash app → Scan QR',
    terms: 'Sample template — check the bKash app for live offers.', isSample: true,
    eligibility: { rails: ['qr'] }, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'nagad', instrument: 'mfs', category: 'grocery', mode: 'cashback', benefitType: 'percent',
    value: 12, maxBenefit: 15_000, minSpend: 80_000,
    title: '12% cashback on groceries', merchants: [], payWith: 'Nagad app → Scan QR',
    terms: 'Sample template — check the Nagad app for live offers.', isSample: true,
    stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'nagad', instrument: 'mfs', category: 'mobile_recharge', mode: 'cashback', benefitType: 'percent',
    value: 5, maxBenefit: 5_000, minSpend: 0,
    title: '5% cashback on recharge', merchants: [], payWith: 'Nagad app → Mobile Recharge',
    terms: 'Sample template.', isSample: true, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  // The tiered pair that makes §4 concrete: same bank, same shelf, different
  // cards, different answers. This is the case a "City Bank has 15% off" summary
  // gets wrong.
  {
    provider: 'citybank', instrument: 'credit_card', category: 'restaurant', mode: 'discount', benefitType: 'percent',
    value: 20, maxBenefit: 100_000, minSpend: 200_000,
    title: '20% off dining — Platinum and Gold', merchants: [], payWith: 'Swipe your City Bank Amex',
    terms: 'Sample template — check City Bank for live offers.', isSample: true,
    eligibility: { cardProductKeys: ['citybank_amex_platinum', 'citybank_amex_gold'], networks: ['amex'], rails: ['pos'] },
    stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'citybank', instrument: 'credit_card', category: 'restaurant', mode: 'discount', benefitType: 'percent',
    value: 10, maxBenefit: 50_000, minSpend: 100_000,
    title: '10% off dining — all Amex cards', merchants: [], payWith: 'Swipe your City Bank Amex',
    terms: 'Sample template.', isSample: true,
    eligibility: { networks: ['amex'], rails: ['pos'] }, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'citybank', instrument: 'credit_card', category: 'grocery', mode: 'discount', benefitType: 'percent',
    value: 10, maxBenefit: 50_000, minSpend: 0,
    title: '10% off at Agora', merchants: ['Agora'], payWith: 'Swipe your Agora Amex',
    terms: 'Sample template.', isSample: true,
    eligibility: { cardProductKeys: ['citybank_amex_agora'], networks: ['amex'] },
    stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'ebl', instrument: 'credit_card', category: 'travel', mode: 'discount', benefitType: 'percent',
    value: 12, maxBenefit: 200_000, minSpend: 500_000,
    title: '12% off hotels and flights', merchants: [], payWith: 'Swipe your EBL card',
    terms: 'Sample template.', isSample: true, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'brac', instrument: 'credit_card', category: 'grocery', mode: 'cashback', benefitType: 'percent',
    value: 8, maxBenefit: 30_000, minSpend: 150_000,
    title: '8% cashback on groceries', merchants: [], payWith: 'Swipe your BRAC card',
    terms: 'Sample template.', isSample: true, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'rocket', instrument: 'mfs', category: 'pharmacy', mode: 'cashback', benefitType: 'percent',
    value: 7, maxBenefit: 10_000, minSpend: 30_000,
    title: '7% cashback at pharmacies', merchants: [], payWith: 'Rocket app → Scan QR',
    terms: 'Sample template.', isSample: true, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
  {
    provider: 'upay', instrument: 'mfs', category: 'ride_share', mode: 'cashback', benefitType: 'flat',
    value: 5_000, maxBenefit: 5_000, minSpend: 20_000,
    title: '৳50 back on rides', merchants: [], payWith: 'Pay with Upay in-app',
    terms: 'Sample template.', isSample: true, stackable: false, sourceRef: SAMPLE_SOURCE,
  },
];

// ─── Queries the screens and the AI both need ────────────────────────────────

/** Offers on instruments the user holds that expire within the window (§11.9). */
export function expiringSoon(
  offers: readonly Offer[],
  held: readonly ProviderKey[],
  nowIso: IsoInstant,
  withinDays = 7,
): Offer[] {
  const heldSet = new Set(held);
  const cutoff = new Date(Date.parse(nowIso) + withinDays * 86_400_000).toISOString();

  return offers
    .filter(
      (offer) =>
        offer.deletedAt == null &&
        heldSet.has(offer.provider) &&
        offer.validTill != null &&
        offer.validTill >= nowIso &&
        offer.validTill <= cutoff,
    )
    .sort((a, b) => (a.validTill ?? '').localeCompare(b.validTill ?? ''));
}

/** Live offers only — expired rows are kept for history but never advertised. */
export function activeOffers(offers: readonly Offer[], nowIso: IsoInstant): Offer[] {
  return offers.filter(
    (offer) =>
      offer.deletedAt == null &&
      (offer.validTill == null || offer.validTill >= nowIso) &&
      (offer.validFrom == null || offer.validFrom <= nowIso),
  );
}

/** Everything on one shelf, for "I need groceries" (§10). */
export function offersForCategory(
  offers: readonly Offer[],
  category: OfferCategoryKey,
  nowIso: IsoInstant,
): Offer[] {
  return activeOffers(offers, nowIso).filter((o) => o.category === category || o.merchants.length > 0);
}
