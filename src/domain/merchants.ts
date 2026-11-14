/**
 * A directory of Bangladeshi merchants, so typing "Sultans Dine" or "shopno"
 * resolves instantly instead of asking the user what kind of shop it is.
 *
 * This is reference data, not a claim about any promotion — it maps a name to a
 * *category*. What each provider actually offers there is a separate question
 * answered by the offer catalogue, which is user-editable and clearly marked
 * where it is sample data (§2.8).
 *
 * Aliases carry the spellings people really type: missing apostrophes, Bangla
 * script, and the shortenings everyone uses ("cineplex", "panda", "shopno").
 */

import type { OfferCategoryKey } from './types.ts';

export type MerchantEntry = {
  /** Canonical display name. */
  name: string;
  category: OfferCategoryKey;
  /** Lowercase forms to match against, longest-first at match time. */
  aliases: readonly string[];
};

export const MERCHANT_DIRECTORY: readonly MerchantEntry[] = [
  // ── Super shops and groceries ──────────────────────────────────────────────
  { name: 'Shwapno', category: 'grocery', aliases: ['shwapno', 'swapno', 'shopno', 'সপ্ন', 'স্বপ্ন'] },
  { name: 'Agora', category: 'grocery', aliases: ['agora', 'আগোরা'] },
  { name: 'Meena Bazar', category: 'grocery', aliases: ['meena bazar', 'mina bazar', 'meenabazar', 'মীনা বাজার'] },
  { name: 'Unimart', category: 'grocery', aliases: ['unimart', 'uni mart'] },
  { name: 'Prince Bazar', category: 'grocery', aliases: ['prince bazar', 'prince bazaar'] },
  { name: 'Daily Shopping', category: 'grocery', aliases: ['daily shopping'] },
  { name: 'Lavender', category: 'grocery', aliases: ['lavender'] },

  // ── Restaurants ────────────────────────────────────────────────────────────
  { name: "Sultan's Dine", category: 'restaurant', aliases: ['sultans dine', "sultan's dine", 'sultan dine', 'সুলতান'] },
  { name: 'Star Kabab', category: 'restaurant', aliases: ['star kabab', 'star kebab', 'স্টার কাবাব'] },
  { name: 'Kacchi Bhai', category: 'restaurant', aliases: ['kacchi bhai', 'kachchi bhai', 'কাচ্চি ভাই'] },
  { name: 'Haji Biriyani', category: 'restaurant', aliases: ['haji biriyani', 'haji biryani', 'হাজী'] },
  { name: 'KFC', category: 'restaurant', aliases: ['kfc'] },
  { name: 'Pizza Hut', category: 'restaurant', aliases: ['pizza hut', 'pizzahut'] },
  { name: 'Burger King', category: 'restaurant', aliases: ['burger king', 'burgerking'] },
  { name: 'BFC', category: 'restaurant', aliases: ['bfc', 'best fried chicken'] },
  { name: 'Madchef', category: 'restaurant', aliases: ['madchef', 'mad chef'] },
  { name: 'Chillox', category: 'restaurant', aliases: ['chillox'] },
  { name: 'Takeout', category: 'restaurant', aliases: ['takeout', 'take out'] },
  { name: 'Secret Recipe', category: 'restaurant', aliases: ['secret recipe'] },
  { name: "Nando's", category: 'restaurant', aliases: ['nandos', "nando's"] },
  { name: 'Crimson Cup', category: 'restaurant', aliases: ['crimson cup'] },
  { name: 'North End Coffee', category: 'restaurant', aliases: ['north end', 'northend'] },
  { name: 'Gloria Jeans', category: 'restaurant', aliases: ['gloria jeans', 'gloria jean'] },

  // ── Food delivery ──────────────────────────────────────────────────────────
  { name: 'Foodpanda', category: 'food_delivery', aliases: ['foodpanda', 'food panda', 'panda'] },
  { name: 'Pathao Food', category: 'food_delivery', aliases: ['pathao food'] },
  { name: 'HungryNaki', category: 'food_delivery', aliases: ['hungrynaki', 'hungry naki'] },

  // ── Fashion ────────────────────────────────────────────────────────────────
  { name: 'Aarong', category: 'fashion', aliases: ['aarong', 'আড়ং'] },
  { name: 'Yellow', category: 'fashion', aliases: ['yellow'] },
  { name: 'Ecstasy', category: 'fashion', aliases: ['ecstasy'] },
  { name: 'Cats Eye', category: 'fashion', aliases: ['cats eye', "cat's eye"] },
  { name: 'Le Reve', category: 'fashion', aliases: ['le reve', 'lereve'] },
  { name: 'Sailor', category: 'fashion', aliases: ['sailor'] },
  { name: 'Apex', category: 'fashion', aliases: ['apex'] },
  { name: 'Bata', category: 'fashion', aliases: ['bata'] },
  { name: 'Richman', category: 'fashion', aliases: ['richman'] },
  { name: 'Artisan', category: 'fashion', aliases: ['artisan'] },
  { name: 'Infinity', category: 'fashion', aliases: ['infinity megamall', 'infinity'] },

  // ── Electronics ────────────────────────────────────────────────────────────
  { name: 'Startech', category: 'electronics', aliases: ['startech', 'star tech'] },
  { name: 'Ryans', category: 'electronics', aliases: ['ryans', "ryan's", 'ryans computers'] },
  { name: 'Techland', category: 'electronics', aliases: ['techland', 'tech land'] },
  { name: 'Computer Source', category: 'electronics', aliases: ['computer source'] },
  { name: 'Samsung', category: 'electronics', aliases: ['samsung'] },
  { name: 'Walton', category: 'electronics', aliases: ['walton', 'ওয়ালটন'] },
  { name: 'Transcom Digital', category: 'electronics', aliases: ['transcom', 'transcom digital'] },

  // ── Online ─────────────────────────────────────────────────────────────────
  { name: 'Daraz', category: 'ecommerce', aliases: ['daraz', 'দারাজ'] },
  { name: 'Chaldal', category: 'ecommerce', aliases: ['chaldal', 'চালডাল'] },
  { name: 'Pickaboo', category: 'ecommerce', aliases: ['pickaboo'] },
  { name: 'Rokomari', category: 'ecommerce', aliases: ['rokomari', 'রকমারি'] },
  { name: 'Othoba', category: 'ecommerce', aliases: ['othoba'] },

  // ── Pharmacy and health ────────────────────────────────────────────────────
  { name: 'Lazz Pharma', category: 'pharmacy', aliases: ['lazz pharma', 'lazz'] },
  { name: 'Wellbeing Pharmacy', category: 'pharmacy', aliases: ['wellbeing', 'well being pharmacy'] },
  { name: 'Labaid', category: 'health', aliases: ['labaid', 'ল্যাবএইড'] },
  { name: 'Square Hospital', category: 'health', aliases: ['square hospital'] },
  { name: 'Popular Diagnostic', category: 'health', aliases: ['popular diagnostic', 'popular'] },
  { name: 'United Hospital', category: 'health', aliases: ['united hospital'] },
  { name: 'Ibn Sina', category: 'health', aliases: ['ibn sina', 'ibnsina'] },
  { name: 'Evercare', category: 'health', aliases: ['evercare', 'apollo hospital'] },

  // ── Rides, fuel, travel ────────────────────────────────────────────────────
  { name: 'Uber', category: 'ride_share', aliases: ['uber'] },
  { name: 'Pathao', category: 'ride_share', aliases: ['pathao', 'পাঠাও'] },
  { name: 'Obhai', category: 'ride_share', aliases: ['obhai'] },
  { name: 'Padma Oil', category: 'fuel', aliases: ['padma oil', 'petrol pump', 'fuel station'] },
  { name: 'Jamuna Oil', category: 'fuel', aliases: ['jamuna oil'] },
  { name: 'Biman Bangladesh', category: 'travel', aliases: ['biman', 'biman bangladesh'] },
  { name: 'US-Bangla Airlines', category: 'travel', aliases: ['us-bangla', 'us bangla'] },
  { name: 'Novoair', category: 'travel', aliases: ['novoair', 'novo air'] },
  { name: 'ShareTrip', category: 'travel', aliases: ['sharetrip', 'share trip'] },
  { name: 'GoZayaan', category: 'travel', aliases: ['gozayaan', 'go zayaan'] },

  // ── Entertainment, utilities, education ────────────────────────────────────
  { name: 'Star Cineplex', category: 'entertainment', aliases: ['star cineplex', 'cineplex'] },
  { name: 'Blockbuster Cinemas', category: 'entertainment', aliases: ['blockbuster'] },
  { name: 'DESCO', category: 'utility_bill', aliases: ['desco'] },
  { name: 'DPDC', category: 'utility_bill', aliases: ['dpdc'] },
  { name: 'WASA', category: 'utility_bill', aliases: ['wasa', 'ওয়াসা'] },
  { name: 'Titas Gas', category: 'utility_bill', aliases: ['titas', 'তিতাস'] },
  { name: 'Grameenphone', category: 'mobile_recharge', aliases: ['grameenphone', 'gp', 'গ্রামীণফোন'] },
  { name: 'Robi', category: 'mobile_recharge', aliases: ['robi', 'রবি'] },
  { name: 'Banglalink', category: 'mobile_recharge', aliases: ['banglalink', 'বাংলালিংক'] },
  { name: 'Airtel', category: 'mobile_recharge', aliases: ['airtel'] },
];

/** Longest alias first, so "pathao food" beats "pathao". */
const ALIAS_INDEX: readonly { alias: string; entry: MerchantEntry }[] = MERCHANT_DIRECTORY.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias, entry })),
).sort((a, b) => b.alias.length - a.alias.length);

export type MerchantMatch = {
  name: string;
  category: OfferCategoryKey;
  /** `directory` is a known chain; `learned` came from the user's own history. */
  via: 'directory' | 'learned';
};

/**
 * Resolve a typed shop name.
 *
 * The user's own merchant memory wins over the directory — if they have
 * corrected "Star Kabab" to Groceries once, that sticks (§18.5). Substring
 * matching is deliberate here rather than the word-boundary rule used for
 * wallet names: people type "shwapno mirpur" and "KFC Dhanmondi", and the
 * branch suffix must not defeat the match.
 */
export function resolveMerchant(
  typed: string,
  learned: ReadonlyMap<string, OfferCategoryKey> = new Map(),
): MerchantMatch | null {
  const needle = typed.trim().toLowerCase();
  if (needle === '') return null;

  for (const [name, category] of learned) {
    if (needle.includes(name.toLowerCase())) {
      return { name: typed.trim(), category, via: 'learned' };
    }
  }

  for (const { alias, entry } of ALIAS_INDEX) {
    if (needle.includes(alias)) return { name: entry.name, category: entry.category, via: 'directory' };
  }
  return null;
}

/** Suggestions for the shop field as the user types. */
export function suggestMerchants(typed: string, limit = 6): MerchantEntry[] {
  const needle = typed.trim().toLowerCase();
  if (needle.length < 2) return [];

  const starts: MerchantEntry[] = [];
  const contains: MerchantEntry[] = [];

  for (const entry of MERCHANT_DIRECTORY) {
    const hay = [entry.name.toLowerCase(), ...entry.aliases];
    if (hay.some((h) => h.startsWith(needle))) starts.push(entry);
    else if (hay.some((h) => h.includes(needle))) contains.push(entry);
  }

  return [...starts, ...contains].slice(0, limit);
}
