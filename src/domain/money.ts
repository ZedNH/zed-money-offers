/**
 * Money. Spec §2.1: every amount in this application is an integer number of
 * paisa. 1 BDT = 100 paisa. Floating point never touches a stored amount.
 *
 * Floats are banned because 0.1 + 0.2 !== 0.3, and a ledger that drifts by a
 * paisa per transaction is a ledger nobody trusts. The only place a fractional
 * value legitimately appears is a *rate* (a percentage, an interest rate), and
 * every function here that accepts one returns an integer.
 *
 * This module is pure: no I/O, no framework, no clock.
 */

/**
 * An integer count of paisa. Kept as a plain `number` alias rather than a
 * branded type so it matches the entity definitions in spec §7 exactly; the
 * guarantee is enforced at runtime by {@link assertPaisa} at every write
 * boundary, and by the fact that nothing in this module can produce a
 * non-integer.
 */
import { currencySymbol } from './region.ts';

export type Paisa = number;

/** Paisa in one taka. */
export const PAISA_PER_TAKA = 100;

/** The currency symbol for BDT. */
export const TAKA_SYMBOL = '৳';

export function getCurrencySymbol(currency?: string) {
  return currencySymbol(currency ?? 'BDT');
}

/**
 * Largest amount we accept. 2^53-1 paisa is ~90 trillion taka, far beyond any
 * real balance, but the bound makes overflow a caught error rather than a
 * silent precision loss.
 */
export const MAX_PAISA = Number.MAX_SAFE_INTEGER;

// ─── Guards ──────────────────────────────────────────────────────────────────

/** True when `n` is a value we are willing to store as money. */
export function isPaisa(n: unknown): n is Paisa {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/**
 * Throws unless `n` is a safe integer. Call this at every boundary where a
 * number becomes a stored amount — repository writes, importers, AI tool
 * results. A loud failure here is vastly cheaper than a corrupt ledger.
 */
export function assertPaisa(n: unknown, label = 'amount'): Paisa {
  if (!isPaisa(n)) {
    throw new TypeError(`${label} must be an integer number of paisa, received: ${String(n)}`);
  }
  return n;
}

/** Throws unless `n` is a positive integer. Spec §6: stored amounts are always positive. */
export function assertPositivePaisa(n: unknown, label = 'amount'): Paisa {
  const v = assertPaisa(n, label);
  if (v <= 0) throw new RangeError(`${label} must be positive, received: ${v}`);
  return v;
}

// ─── Rounding ────────────────────────────────────────────────────────────────

/**
 * Round half away from zero — the convention people expect when money is
 * divided (৳0.5 becomes ৳1, −৳0.5 becomes −৳1).
 *
 * `Math.round` is not usable here: it rounds half *up* on the number line, so
 * `Math.round(-0.5)` is `-0`, which makes a discount and a refund of the same
 * size disagree by a paisa.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`cannot round non-finite value: ${String(value)}`);
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/** Convert taka (possibly fractional) to paisa, rounding to the nearest paisa. */
export function takaToPaisa(taka: number): Paisa {
  if (!Number.isFinite(taka)) throw new RangeError(`cannot convert non-finite taka: ${String(taka)}`);
  // Multiplying first and rounding once keeps 45.67 → 4567 rather than 4566.
  const paisa = roundHalfAwayFromZero(taka * PAISA_PER_TAKA);
  return assertPaisa(paisa, 'taka');
}

/**
 * Convert paisa to taka as a float. **Display only** — never store or do
 * further arithmetic on the result.
 */
export function paisaToTaka(paisa: Paisa): number {
  return assertPaisa(paisa) / PAISA_PER_TAKA;
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

/** Sum a list of paisa amounts, checking for overflow. */
export function sumPaisa(amounts: readonly Paisa[]): Paisa {
  let total = 0;
  for (const a of amounts) {
    total += assertPaisa(a);
    if (!Number.isSafeInteger(total)) {
      throw new RangeError('paisa sum exceeded safe integer range');
    }
  }
  return total;
}

/** `a + b`, validated. */
export function addPaisa(a: Paisa, b: Paisa): Paisa {
  return assertPaisa(assertPaisa(a, 'a') + assertPaisa(b, 'b'), 'sum');
}

/** `a - b`, validated. */
export function subPaisa(a: Paisa, b: Paisa): Paisa {
  return assertPaisa(assertPaisa(a, 'a') - assertPaisa(b, 'b'), 'difference');
}

/** Absolute value. */
export function absPaisa(a: Paisa): Paisa {
  return Math.abs(assertPaisa(a));
}

/**
 * `percent` percent of `amount`, rounded to the nearest paisa.
 * Used by the offer engine (§11), interest math (§14.4), and zakat (§14.9).
 */
export function percentOfPaisa(amount: Paisa, percent: number): Paisa {
  assertPaisa(amount);
  if (!Number.isFinite(percent)) throw new RangeError(`percent must be finite, received: ${String(percent)}`);
  return assertPaisa(roundHalfAwayFromZero((amount * percent) / 100), 'percentage');
}

/**
 * `amount` as a fraction of `of`, in percent. Returns `null` when `of` is zero
 * rather than `Infinity` or `NaN`, so callers must decide what "x% of nothing"
 * means instead of rendering it.
 */
export function ratioPercent(amount: Paisa, of: Paisa): number | null {
  assertPaisa(amount);
  assertPaisa(of);
  if (of === 0) return null;
  return (amount / of) * 100;
}

/**
 * Split `total` into `ways` equal parts whose sum is exactly `total`.
 *
 * This is what "split the 2400 dinner three ways" (§10.3) actually needs:
 * 2400 / 3 is clean, but 2500 / 3 is not, and the paisa left over has to land
 * somewhere or the split silently loses money. The remainder goes to the
 * earliest shares — callers that want the payer to absorb it should put the
 * payer first.
 */
export function splitPaisa(total: Paisa, ways: number): Paisa[] {
  assertPaisa(total);
  if (!Number.isSafeInteger(ways) || ways <= 0) {
    throw new RangeError(`ways must be a positive integer, received: ${String(ways)}`);
  }
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / ways);
  const remainder = magnitude - base * ways;
  const shares: Paisa[] = [];
  for (let i = 0; i < ways; i++) {
    shares.push(sign * (base + (i < remainder ? 1 : 0)));
  }
  return shares;
}

/**
 * Split `total` across `weights` proportionally, with the sum of the result
 * exactly equal to `total` (largest-remainder apportionment).
 *
 * Backs uneven bill splits (§14.6) — "Karim had the biryani, I had tea".
 */
export function allocatePaisa(total: Paisa, weights: readonly number[]): Paisa[] {
  assertPaisa(total);
  if (weights.length === 0) throw new RangeError('allocatePaisa needs at least one weight');
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`weights must be finite and non-negative, received: ${String(w)}`);
  }
  const weightTotal = weights.reduce((acc, w) => acc + w, 0);
  if (weightTotal <= 0) throw new RangeError('weights must sum to more than zero');

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / weightTotal);
  const floors = exact.map((v) => Math.floor(v));
  let assigned = floors.reduce((acc, v) => acc + v, 0);

  // Hand out the leftover paisa to the shares with the largest fractional part.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  let cursor = 0;
  while (assigned < magnitude) {
    const slot = order[cursor % order.length];
    /* c8 ignore next -- order is non-empty, so slot is always defined */
    if (!slot) break;
    result[slot.i] = (result[slot.i] ?? 0) + 1;
    assigned += 1;
    cursor += 1;
  }

  return result.map((v) => sign * v);
}

// ─── Digits ──────────────────────────────────────────────────────────────────

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

/** Render ASCII digits in a string as Bengali numerals (§15.5). */
export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);
}

/**
 * Normalise Bengali numerals in a string to ASCII digits.
 * Every parser in the app runs input through this first, so "৩০০ টাকা" and
 * "300 taka" take the same code path.
 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export type NumberFormat = 'lakh_crore' | 'international';
export type DigitStyle = 'ascii' | 'bengali';
export type DecimalStyle = 'auto' | 'always' | 'never';

export type FormatMoneyOptions = {
  /** §15.5: ৳1,25,430 (default, Bangladeshi) vs ৳125,430. */
  numberFormat?: NumberFormat;
  /** §15.5: render digits as ০১২৩ instead of 0123. */
  digits?: DigitStyle;
  /** Show the ৳ symbol. */
  symbol?: boolean;
  /** `auto` shows paisa only when non-zero. */
  decimals?: DecimalStyle;
  /** Render an explicit `+` for positive values (used for deltas). */
  signDisplay?: 'auto' | 'always';
  /** Currency code to use for symbol mapping. Defaults to BDT (৳). */
  currency?: string;
};

/**
 * Group an integer digit string the Bangladeshi way: the last three digits,
 * then pairs. 12543050 → "1,25,43,050".
 */
export function groupLakhCrore(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${groupedHead},${tail}`;
}

/** Group an integer digit string in thousands: 12543050 → "12,543,050". */
export function groupInternational(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format paisa for display. This is the *only* place money becomes a string,
 * and the only place a fractional representation of an amount exists.
 *
 * Satisfies §18.13: `formatPaisa(12543000)` → `৳1,25,430`.
 */
export function formatPaisa(paisa: Paisa, options: FormatMoneyOptions = {}): string {
  assertPaisa(paisa);
  const {
    numberFormat = 'lakh_crore',
    digits = 'ascii',
    symbol = true,
    decimals = 'auto',
    signDisplay = 'auto',
    currency = 'BDT',
  } = options;

  const parsedCurrency = String(currency).toUpperCase();
  const currencySymbol = getCurrencySymbol(parsedCurrency);

  const negative = paisa < 0;
  const magnitude = Math.abs(paisa);
  const wholeTaka = Math.floor(magnitude / PAISA_PER_TAKA);
  const paisaPart = magnitude % PAISA_PER_TAKA;

  const grouped =
    numberFormat === 'lakh_crore'
      ? groupLakhCrore(String(wholeTaka))
      : groupInternational(String(wholeTaka));

  const showDecimals = decimals === 'always' || (decimals === 'auto' && paisaPart !== 0);
  let body = showDecimals ? `${grouped}.${String(paisaPart).padStart(2, '0')}` : grouped;

  if (digits === 'bengali') body = toBengaliDigits(body);

  const sign = negative ? '-' : signDisplay === 'always' && paisa > 0 ? '+' : '';
  return `${sign}${symbol ? currencySymbol : ''}${body}`;
}

/**
 * Compact form for dense UI (tiles, chart axes): ৳1.25L, ৳2.4Cr.
 * Always an approximation — never use it where the exact figure matters.
 */
export function formatPaisaCompact(paisa: Paisa, options: FormatMoneyOptions = {}): string {
  assertPaisa(paisa);
  const { digits = 'ascii', symbol = true, currency = 'BDT' } = options;
  const currencySymbol = getCurrencySymbol(currency);
  const negative = paisa < 0;
  const taka = Math.abs(paisa) / PAISA_PER_TAKA;

  let body: string;
  if (taka >= 10_000_000) body = `${trimZeros(taka / 10_000_000)}Cr`;
  else if (taka >= 100_000) body = `${trimZeros(taka / 100_000)}L`;
  else if (taka >= 1_000) body = `${trimZeros(taka / 1_000)}K`;
  else body = trimZeros(taka);

  if (digits === 'bengali') body = toBengaliDigits(body);
  return `${negative ? '-' : ''}${symbol ? currencySymbol : ''}${body}`;
}

function trimZeros(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a typed amount into paisa. Accepts ASCII and Bengali numerals, the ৳
 * symbol, `Tk`/`BDT`, and both digit-grouping conventions.
 *
 * Deliberately narrow: this handles what a person types into an *amount field*.
 * Word multipliers ("3 hazar", "২ লাখ") belong to the natural-language parser
 * and land in Phase 3 — putting them here would make an input box guess.
 *
 * Returns `null` for anything it cannot parse. It never guesses.
 */
export function parseAmountToPaisa(input: string): Paisa | null {
  const normalised = toAsciiDigits(input)
    .replace(/[৳$]|(?:^|\s)(?:tk|bdt|taka)\b\.?/gi, ' ')
    .replace(/\s+/g, '')
    .trim();

  if (normalised === '') return null;

  const match = /^(-?)(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(normalised);
  if (!match) return null;

  const [, sign, wholeRaw, fracRaw] = match;
  if (wholeRaw === undefined) return null;

  // Reject a stray trailing comma, but accept either grouping convention —
  // people paste ৳1,25,430 and ৳125,430 interchangeably.
  if (wholeRaw.endsWith(',')) return null;
  const whole = wholeRaw.replace(/,/g, '');
  if (!/^\d+$/.test(whole)) return null;

  const frac = (fracRaw ?? '').padEnd(2, '0');
  const paisa = Number(whole) * PAISA_PER_TAKA + Number(frac);
  if (!Number.isSafeInteger(paisa)) return null;

  return sign === '-' ? -paisa : paisa;
}
