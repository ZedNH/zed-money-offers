/**
 * Bangladeshi financial providers, transcribed from spec §8.
 *
 * This table earns its keep three times over: it gives accounts their icon and
 * colour, it tells the offer engine which instruments the user actually holds
 * (§11.1), and its aliases are what let the parser recognise "bikash", "বিকাশ"
 * and "bKash" as the same wallet.
 *
 * Aliases are matched case-insensitively against normalised text, so they are
 * stored lowercase. Bengali forms are included because people type both.
 *
 * §8 requires users to be able to add a provider that is not on this list;
 * seeded rows carry `isSeed: true` so a future update can refresh them without
 * touching anything the user created.
 *
 * The colours below are for UI identification only. They are approximations of
 * each brand's public identity, not licensed assets.
 */

import type { Provider, ProviderKey } from '../types.ts';

export const SEED_PROVIDERS: readonly Provider[] = [
  // ── Mobile financial services ──────────────────────────────────────────────
  { key: 'bkash', label: 'bKash', kind: 'mfs', aliases: ['bkash', 'bikash', 'bkash app', 'বিকাশ'], color: '#E2136E', icon: 'smartphone', isSeed: true },
  { key: 'nagad', label: 'Nagad', kind: 'mfs', aliases: ['nagad', 'নগদ'], color: '#F47B20', icon: 'smartphone', isSeed: true },
  { key: 'rocket', label: 'Rocket (DBBL)', kind: 'mfs', aliases: ['rocket', 'dbbl rocket', 'রকেট'], color: '#8B2C88', icon: 'smartphone', isSeed: true },
  { key: 'upay', label: 'Upay', kind: 'mfs', aliases: ['upay', 'upay wallet', 'উপায়'], color: '#F05A28', icon: 'smartphone', isSeed: true },
  { key: 'tap', label: 'Tap', kind: 'mfs', aliases: ['tap', 'trust axiata', 'trust axiata pay'], color: '#00A9E0', icon: 'smartphone', isSeed: true },
  { key: 'mcash', label: 'mCash', kind: 'mfs', aliases: ['mcash', 'm-cash', 'm cash'], color: '#009639', icon: 'smartphone', isSeed: true },

  // ── International & Digital ────────────────────────────────────────────────
  { key: 'wise', label: 'Wise', kind: 'digital', aliases: ['wise', 'transferwise'], color: '#9FE870', icon: 'globe', isSeed: true },
  { key: 'redotpay', label: 'RedotPay', kind: 'digital', aliases: ['redotpay', 'redot pay'], color: '#E53935', icon: 'credit-card', isSeed: true },
  { key: 'paypal', label: 'PayPal', kind: 'digital', aliases: ['paypal', 'pay pal'], color: '#00457C', icon: 'globe', isSeed: true },
  { key: 'payoneer', label: 'Payoneer', kind: 'digital', aliases: ['payoneer'], color: '#FF4800', icon: 'building', isSeed: true },
  { key: 'revolut', label: 'Revolut', kind: 'digital', aliases: ['revolut'], color: '#0075EB', icon: 'smartphone', isSeed: true },
  { key: 'binance', label: 'Binance', kind: 'digital', aliases: ['binance', 'usdt', 'crypto'], color: '#FCD535', icon: 'globe', isSeed: true },
  { key: 'skrill', label: 'Skrill', kind: 'digital', aliases: ['skrill'], color: '#730E39', icon: 'globe', isSeed: true },
  { key: 'stripe', label: 'Stripe', kind: 'digital', aliases: ['stripe'], color: '#635BFF', icon: 'credit-card', isSeed: true },
  { key: 'perfectmoney', label: 'Perfect Money', kind: 'digital', aliases: ['perfect money', 'perfectmoney'], color: '#D4212D', icon: 'globe', isSeed: true },
  { key: 'webmoney', label: 'WebMoney', kind: 'digital', aliases: ['webmoney', 'web money'], color: '#0070BA', icon: 'globe', isSeed: true },
  { key: 'payeer', label: 'Payeer', kind: 'digital', aliases: ['payeer'], color: '#00AAFF', icon: 'globe', isSeed: true },

  // ── Banks ──────────────────────────────────────────────────────────────────
  { key: 'dbbl', label: 'Dutch-Bangla Bank', kind: 'bank', aliases: ['dbbl', 'dutch bangla', 'dutch-bangla', 'nexus'], color: '#0066B3', icon: 'building', isSeed: true },
  { key: 'citybank', label: 'City Bank', kind: 'bank', aliases: ['city bank', 'citybank', 'city amex'], color: '#E4002B', icon: 'building', isSeed: true },
  { key: 'ebl', label: 'Eastern Bank', kind: 'bank', aliases: ['ebl', 'eastern bank', 'skybanking'], color: '#00447C', icon: 'building', isSeed: true },
  { key: 'brac', label: 'BRAC Bank', kind: 'bank', aliases: ['brac', 'brac bank', 'astha'], color: '#E31E24', icon: 'building', isSeed: true },
  { key: 'ibbl', label: 'Islami Bank', kind: 'bank', aliases: ['islami', 'ibbl', 'islami bank', 'cellfin'], color: '#006E51', icon: 'building', isSeed: true },
  { key: 'scb', label: 'Standard Chartered', kind: 'bank', aliases: ['standard chartered', 'scb'], color: '#0473EA', icon: 'building', isSeed: true },
  { key: 'mtb', label: 'Mutual Trust Bank', kind: 'bank', aliases: ['mtb', 'mutual trust'], color: '#ED1C24', icon: 'building', isSeed: true },
  { key: 'ucb', label: 'United Commercial', kind: 'bank', aliases: ['ucb', 'united commercial'], color: '#F58220', icon: 'building', isSeed: true },
  { key: 'sebl', label: 'Southeast Bank', kind: 'bank', aliases: ['sebl', 'southeast', 'southeast bank'], color: '#00693E', icon: 'building', isSeed: true },
  { key: 'pubali', label: 'Pubali Bank', kind: 'bank', aliases: ['pubali', 'pubali bank'], color: '#1A4F9C', icon: 'building', isSeed: true },

  // ── Card networks ──────────────────────────────────────────────────────────
  { key: 'visa', label: 'VISA', kind: 'network', aliases: ['visa'], color: '#1A1F71', icon: 'credit-card', isSeed: true },
  { key: 'mastercard', label: 'Mastercard', kind: 'network', aliases: ['mastercard', 'master card'], color: '#EB001B', icon: 'credit-card', isSeed: true },
  { key: 'amex', label: 'American Express', kind: 'network', aliases: ['amex', 'american express'], color: '#006FCF', icon: 'credit-card', isSeed: true },
];

const BY_KEY: ReadonlyMap<string, Provider> = new Map(SEED_PROVIDERS.map((p) => [p.key, p]));

/** Look up a seeded provider. Returns `null` for user-added keys. */
export function findProvider(key: ProviderKey): Provider | null {
  return BY_KEY.get(key) ?? null;
}

/** Seeded providers of one kind, in table order. */
export function providersOfKind(kind: Provider['kind']): Provider[] {
  return SEED_PROVIDERS.filter((p) => p.kind === kind);
}

/**
 * Longest alias first, so "dutch bangla" wins over "dbbl" when both appear and
 * "city bank" is never shadowed by a shorter partial match.
 */
const ALIAS_INDEX: readonly { alias: string; provider: Provider }[] = SEED_PROVIDERS.flatMap((provider) =>
  provider.aliases.map((alias) => ({ alias, provider })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Identify the provider named in a piece of free text — an account name the
 * user typed, or an utterance like "basha vara 15000 dilam city bank theke".
 *
 * Deliberately conservative: it matches on word boundaries, so "taproom" does
 * not resolve to Tap and a Nagad-shaped substring inside a longer word does not
 * silently pick a wallet. Returns `null` when nothing matches, and the caller
 * asks rather than guesses (§2.5).
 */
export function matchProvider(text: string): Provider | null {
  // `\p{M}` is not optional here. Bengali vowel signs are combining marks, not
  // letters, so a pattern of `\p{L}\p{N}` alone shreds "বিকাশ" into "ব ক শ" and
  // no Bangla alias ever matches.
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim()} `;
  for (const { alias, provider } of ALIAS_INDEX) {
    if (haystack.includes(` ${alias} `)) return provider;
  }
  return null;
}

/**
 * Which providers a set of account names implies.
 *
 * §11.1 is explicit that this cannot be the whole story — "most people name
 * their account 'Savings', not 'bKash'" — so the offer engine treats this as a
 * hint and the explicit wallet picker as the authority.
 */
export function detectProviders(accountNames: readonly string[]): ProviderKey[] {
  const found = new Set<ProviderKey>();
  for (const name of accountNames) {
    const provider = matchProvider(name);
    if (provider) found.add(provider.key);
  }
  return [...found];
}
