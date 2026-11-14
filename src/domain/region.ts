/**
 * Countries the app knows how to set itself up for: currency, number style
 * (lakh/crore or thousands), weekend days, and whether the Bangladesh-only
 * features apply (Bangla, the bKash/Nagad message reader, the offer catalogue).
 *
 * The same table lives on the phone (domain/region/Region.kt). Picking a
 * country writes `country`, `currency`, `numberFormat` and `weekendDays` into
 * the settings both apps share.
 */

export type Country = {
  code: string;
  name: string;
  flag: string;
  currency: string;
  numberFormat: 'lakh_crore' | 'international';
  /** JS weekday numbers, 0 = Sunday … 6 = Saturday. */
  weekend: number[];
};

const FRI_SAT = [5, 6];
const SAT_SUN = [6, 0];
const LAKH = 'lakh_crore' as const;
const INTL = 'international' as const;

export const COUNTRIES: readonly Country[] = [
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', currency: 'BDT', numberFormat: LAKH, weekend: FRI_SAT },
  { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR', numberFormat: LAKH, weekend: SAT_SUN },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', currency: 'PKR', numberFormat: LAKH, weekend: SAT_SUN },
  { code: 'NP', name: 'Nepal', flag: '🇳🇵', currency: 'NPR', numberFormat: LAKH, weekend: [6] },
  { code: 'LK', name: 'Sri Lanka', flag: '🇱🇰', currency: 'LKR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦', currency: 'QAR', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼', currency: 'KWD', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'OM', name: 'Oman', flag: '🇴🇲', currency: 'OMR', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'BH', name: 'Bahrain', flag: '🇧🇭', currency: 'BHD', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', currency: 'VND', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'CN', name: 'China', flag: '🇨🇳', currency: 'CNY', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', currency: 'KRW', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'FR', name: 'France', flag: '🇫🇷', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', currency: 'EUR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', currency: 'SEK', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', currency: 'NOK', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', currency: 'DKK', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', currency: 'CHF', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', currency: 'PLN', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'TR', name: 'Türkiye', flag: '🇹🇷', currency: 'TRY', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', currency: 'EGP', numberFormat: INTL, weekend: FRI_SAT },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL', numberFormat: INTL, weekend: SAT_SUN },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', currency: 'ARS', numberFormat: INTL, weekend: SAT_SUN },
];

export const DEFAULT_COUNTRY = 'BD';

export function findCountry(code: string | undefined | null): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** Bangladesh-only features (Bangla, bKash/Nagad reading, offers) apply. */
export function isBangladesh(country: string | undefined | null): boolean {
  return (country ?? DEFAULT_COUNTRY) === 'BD';
}

/** The country this device suggests, from its language/region (e.g. "en-AE" → AE). */
export function guessCountry(): string {
  try {
    const langs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
    for (const l of langs) {
      const region = l?.split('-')[1]?.toUpperCase();
      if (region && findCountry(region)) return region;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'Asia/Dhaka') return 'BD';
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IN';
    if (tz === 'Asia/Karachi') return 'PK';
    if (tz === 'Asia/Dubai') return 'AE';
    if (tz === 'Asia/Riyadh') return 'SA';
    if (tz === 'Asia/Kuala_Lumpur') return 'MY';
    if (tz === 'Europe/London') return 'GB';
  } catch { /* fall through */ }
  return DEFAULT_COUNTRY;
}

const symbolCache = new Map<string, string>();

/** "৳", "$", "AED", "€" — the short symbol for a currency code. */
export function currencySymbol(code: string | undefined): string {
  const c = (code || 'BDT').toUpperCase();
  if (c === 'BDT') return '৳';
  const hit = symbolCache.get(c);
  if (hit) return hit;
  let s = c;
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value;
    if (part) s = part;
  } catch { /* unknown code: show the code */ }
  // Codes written as letters read better with a space: "AED 120".
  if (/^[A-Z]{2,4}$/.test(s)) s = `${s} `;
  symbolCache.set(c, s);
  return s;
}

// ─── The user's own currency, for code that has no settings to hand ─────────

let base = 'BDT';

/** Called by the store whenever settings change. */
export function setBaseCurrency(code: string | undefined): void {
  base = (code || 'BDT').toUpperCase();
}

export function baseCurrency(): string {
  return base;
}

/** True for an account in the user's own currency (blank counts as theirs). */
export function isBaseCurrency(code: string | undefined | null): boolean {
  return !code || code.toUpperCase() === base;
}

let country = DEFAULT_COUNTRY;

/** Called by the store whenever settings change. */
export function setCurrentCountry(code: string | undefined): void {
  country = code || DEFAULT_COUNTRY;
}

export function currentCountry(): string {
  return country;
}

/** Screens that only make sense in Bangladesh (the offer catalogue is bKash / Bangladeshi cards). */
export function isPathAvailable(path: string): boolean {
  return path !== '/offers' || isBangladesh(country);
}
