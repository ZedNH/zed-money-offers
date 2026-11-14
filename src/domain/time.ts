/**
 * Time. Spec §6: instants are stored as ISO 8601 UTC strings; the user's
 * timezone (default `Asia/Dhaka`) is a separate setting.
 *
 * Everything a user reads — "today", which month a transaction lands in, when a
 * budget period starts — is a *zoned wall-clock* question, and getting it wrong
 * puts a 2 a.m. dinner in the wrong month. This module does that conversion
 * with `Intl`, which every target runtime ships, so we carry no timezone
 * database of our own.
 *
 * Pure: no clock is read here. Callers pass `now` in.
 */

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

/** An ISO 8601 instant in UTC, e.g. `2026-08-08T14:30:00.000Z`. */
export type IsoInstant = string;

/** A calendar day in the user's timezone, e.g. `2026-08-08`. */
export type DayKey = string;

/** A budget period, e.g. `2026-08`. Not necessarily a calendar month — see §7 `monthStartDay`. */
export type MonthKey = string;

export type ZonedParts = {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number;
  minute: number;
  second: number;
};

// ─── Basics ──────────────────────────────────────────────────────────────────

/** Convert a `Date` to the canonical storage format. */
export function toIso(date: Date): IsoInstant {
  if (Number.isNaN(date.getTime())) throw new RangeError('cannot serialise an invalid Date');
  return date.toISOString();
}

/** Parse a stored instant. Returns `null` rather than an Invalid Date. */
export function parseIso(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parse a stored instant, throwing on malformed input. */
export function requireIso(iso: string, label = 'timestamp'): Date {
  const date = parseIso(iso);
  if (!date) throw new RangeError(`${label} is not a valid ISO instant: ${iso}`);
  return date;
}

// ─── Timezone conversion ─────────────────────────────────────────────────────

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Break an instant into wall-clock parts as seen in `timeZone`. */
export function zonedParts(iso: IsoInstant, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const date = requireIso(iso);
  const parts = partsFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a ${type} part for ${timeZone}`);
    return Number(found.value);
  };
  // `hour12: false` can render midnight as hour 24 in some engines.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The offset of `timeZone` from UTC, in milliseconds, at the given instant. */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const parts = zonedParts(new Date(utcMs).toISOString(), timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Storage keeps milliseconds; Intl does not, so restore them before differencing.
  return asIfUtc - (utcMs - (utcMs % 1000));
}

/**
 * Convert a wall-clock time in `timeZone` to the UTC instant it names.
 *
 * The offset depends on the instant, and the instant is what we are solving
 * for, so this guesses once and corrects. Two passes settles every real case
 * including DST transitions. (Asia/Dhaka has no DST today, but the app must not
 * quietly break for a user who travels or emigrates.)
 */
export function zonedTimeToIso(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number; ms?: number },
  timeZone: string = DEFAULT_TIMEZONE,
): IsoInstant {
  const { year, month, day, hour = 0, minute = 0, second = 0, ms = 0 } = parts;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let utcMs = naive - offsetMsAt(naive, timeZone);
  utcMs = naive - offsetMsAt(utcMs, timeZone);
  return new Date(utcMs).toISOString();
}

/** The calendar day an instant falls on, in the user's timezone. */
export function dayKey(iso: IsoInstant, timeZone: string = DEFAULT_TIMEZONE): DayKey {
  const { year, month, day } = zonedParts(iso, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Midnight at the start of the given instant's day, in the user's timezone. */
export function startOfDayIso(iso: IsoInstant, timeZone: string = DEFAULT_TIMEZONE): IsoInstant {
  const { year, month, day } = zonedParts(iso, timeZone);
  return zonedTimeToIso({ year, month, day }, timeZone);
}

/** Midnight starting the *next* day — an exclusive upper bound for "today". */
export function endOfDayIso(iso: IsoInstant, timeZone: string = DEFAULT_TIMEZONE): IsoInstant {
  const { year, month, day } = zonedParts(iso, timeZone);
  return addDaysIso(zonedTimeToIso({ year, month, day }, timeZone), 1, timeZone);
}

/**
 * Shift an instant by whole calendar days in the user's timezone.
 * Calendar-aware rather than `+86400000`, so a DST day is still one day.
 */
export function addDaysIso(iso: IsoInstant, days: number, timeZone: string = DEFAULT_TIMEZONE): IsoInstant {
  const p = zonedParts(iso, timeZone);
  return zonedTimeToIso(
    { year: p.year, month: p.month, day: p.day + days, hour: p.hour, minute: p.minute, second: p.second },
    timeZone,
  );
}

/** Whole days from `fromIso` to `toIso`, counted by calendar day boundaries. */
export function daysBetween(fromIso: IsoInstant, toIso: IsoInstant, timeZone: string = DEFAULT_TIMEZONE): number {
  const a = Date.parse(startOfDayIso(fromIso, timeZone));
  const b = Date.parse(startOfDayIso(toIso, timeZone));
  return Math.round((b - a) / 86_400_000);
}

/** `today` / `yesterday` / `tomorrow`, or `null` when it is further away. The UI supplies the wording (en/bn). */
export function relativeDayKind(
  iso: IsoInstant,
  nowIso: IsoInstant,
  timeZone: string = DEFAULT_TIMEZONE,
): 'today' | 'yesterday' | 'tomorrow' | null {
  switch (daysBetween(nowIso, iso, timeZone)) {
    case 0:
      return 'today';
    case -1:
      return 'yesterday';
    case 1:
      return 'tomorrow';
    default:
      return null;
  }
}

// ─── Budget periods ──────────────────────────────────────────────────────────

/**
 * Which month a cycle is filed under when `monthStartDay` is not 1.
 *
 * With a salary cycle starting on the 25th, the period 25 Jul – 24 Aug spends
 * 24 of its 31 days in August, so `'end'` (the default) labels it `2026-08`.
 * `'start'` would label the same period `2026-07`.
 *
 * PENDING CONFIRMATION: the spec does not state a convention. See the Phase 0
 * report — this default is a placeholder, not a decision.
 */
export type CycleLabelling = 'start' | 'end';

/**
 * `monthStartDay` is clamped to 1–28. Days 29–31 do not exist in every month,
 * and a budget period that silently vanishes each February is worse than one
 * that starts a couple of days early.
 */
export function clampMonthStartDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(28, Math.max(1, Math.trunc(day)));
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Build a `MonthKey` from a year and 1-based month, normalising overflow. */
export function monthKeyOf(year: number, month: number): MonthKey {
  const zeroBased = month - 1;
  const y = year + Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12;
  return `${pad(y, 4)}-${pad(m + 1, 2)}`;
}

/** Split a `MonthKey` back into numbers. Throws on malformed input. */
export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`not a month key: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError(`month out of range: ${key}`);
  return { year, month };
}

/** Step a `MonthKey` forward or backward. */
export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonthKey(key);
  return monthKeyOf(year, month + delta);
}

/** The half-open instant range `[start, end)` covered by a budget period. */
export type MonthRange = { key: MonthKey; startIso: IsoInstant; endIso: IsoInstant };

/**
 * The instant range for a budget period.
 *
 * With `monthStartDay = 1` this is the plain calendar month. With
 * `monthStartDay = 25` and `labelling = 'end'`, `2026-08` runs from
 * 2026-07-25T00:00 to 2026-08-25T00:00 in the user's timezone.
 */
export function monthRange(
  key: MonthKey,
  timeZone: string = DEFAULT_TIMEZONE,
  monthStartDay = 1,
  labelling: CycleLabelling = 'end',
): MonthRange {
  const startDay = clampMonthStartDay(monthStartDay);
  const { year, month } = parseMonthKey(key);

  // A calendar month always starts in its own labelled month. A shifted cycle
  // labelled by its end month starts in the month before.
  const startMonthOffset = startDay === 1 || labelling === 'start' ? 0 : -1;

  const startIso = zonedTimeToIso({ year, month: month + startMonthOffset, day: startDay }, timeZone);
  const endIso = zonedTimeToIso({ year, month: month + startMonthOffset + 1, day: startDay }, timeZone);
  return { key, startIso, endIso };
}

/** Which budget period an instant belongs to. The inverse of {@link monthRange}. */
export function monthKeyFor(
  iso: IsoInstant,
  timeZone: string = DEFAULT_TIMEZONE,
  monthStartDay = 1,
  labelling: CycleLabelling = 'end',
): MonthKey {
  const startDay = clampMonthStartDay(monthStartDay);
  const { year, month, day } = zonedParts(iso, timeZone);

  if (startDay === 1) return monthKeyOf(year, month);

  // Before the cycle day, we are still inside the cycle that opened last month.
  const cycleStartMonthOffset = day >= startDay ? 0 : -1;
  const labelOffset = labelling === 'start' ? 0 : 1;
  return monthKeyOf(year, month + cycleStartMonthOffset + labelOffset);
}

/** True when the instant falls inside the half-open range. */
export function isWithinRange(iso: IsoInstant, range: { startIso: IsoInstant; endIso: IsoInstant }): boolean {
  const t = Date.parse(iso);
  return t >= Date.parse(range.startIso) && t < Date.parse(range.endIso);
}
