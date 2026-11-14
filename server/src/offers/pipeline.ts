/**
 * The ingestion pipeline.
 *
 *     adapters → parse → normalise → validate → dedupe → catalogue
 *
 * Two decisions here are worth stating.
 *
 * **The normaliser is the app's own.** `parseTerms`, `normaliseCategory` and
 * `dedupeKeyFor` are imported from `src/domain/offers/normalize.ts` — the same
 * functions the client uses, with the same 20-odd unit tests behind them. A
 * server-side reimplementation would drift, and the drift would show up as a
 * discount the catalogue and the advisor disagree about.
 *
 * **A campaign that vanishes is expired, never deleted.** §16 asks "is this a
 * good offer, or should I wait?", and that question is unanswerable without the
 * campaigns that ended. So a row missing from a fresh crawl gets an end date;
 * it does not get removed.
 *
 * Validation is a real gate rather than a formality. An offer with no readable
 * benefit is dropped with a reason, because a row that says "10% off" with no
 * parsed percentage cannot be ranked, and putting it in the catalogue anyway
 * would mean the optimizer silently valued it at zero while the UI displayed
 * the headline.
 */

import {
  dedupeKeyFor,
  looksLikeDuplicate,
  normaliseCategory,
  parseTerms,
} from '../../../src/domain/offers/normalize.ts';
import { categoriseShop } from '../../../src/domain/offers/catalogue.ts';
import { findProvider } from '../../../src/domain/reference/providers.ts';
import type { OfferSourceAdapter, RawOffer, SourceOutcome } from './adapter.ts';
import { cardKeysFrom, parseDuration } from './adapters/citybank.ts';
import { createGenericAdapter } from './adapters/generic.ts';
import { createCollector } from './http.ts';
import type { CatalogueOffer, OfferStore } from './store.ts';

export type PipelineOptions = {
  adapters: readonly OfferSourceAdapter[];
  store: OfferStore;
  /** Ceiling per source, so one sprawling site cannot consume the whole run. */
  maxPagesPerSource?: number;
  nowIso?: string;
  log?: (message: string) => void;
};

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  requests: number;
  sources: {
    key: string;
    displayName: string;
    status: 'ok' | 'declined' | 'failed';
    pagesFetched: number;
    rawOffers: number;
    accepted: number;
    rejected: { reason: string; count: number }[];
    duplicatesMerged: number;
    warnings: string[];
  }[];
  /** Rows in the catalogue no longer present at their source, now marked expired. */
  expired: number;
  blockedByRobots: string[];
  totalOffers: number;
};

export async function runIngestion(options: PipelineOptions): Promise<RunReport> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const log = options.log ?? ((): void => undefined);
  const maxPages = options.maxPagesPerSource ?? 40;

  const collector = createCollector({ validationCache: await options.store.validationCache(), log });
  const report: RunReport = {
    startedAt: nowIso,
    finishedAt: nowIso,
    requests: 0,
    sources: [],
    expired: 0,
    blockedByRobots: [],
    totalOffers: 0,
  };

  const existing = await options.store.all();
  const seenKeys = new Set<string>();
  const accepted: CatalogueOffer[] = [];

  for (const adapter of options.adapters) {
    const outcome = await runAdapter(adapter, collector.fetchPage, log, maxPages);

    if (!outcome.ok) {
      report.sources.push({
        key: adapter.key,
        displayName: adapter.displayName,
        status: 'failed',
        pagesFetched: 0,
        rawOffers: 0,
        accepted: 0,
        rejected: [],
        duplicatesMerged: 0,
        warnings: [outcome.error],
      });
      continue;
    }

    const rejected = new Map<string, number>();
    let duplicatesMerged = 0;
    let acceptedHere = 0;

    for (const raw of outcome.result.offers) {
      const converted = normalise(raw, adapter, nowIso);
      if (typeof converted === 'string') {
        rejected.set(converted, (rejected.get(converted) ?? 0) + 1);
        continue;
      }

      // Same campaign, seen again this run or already in the catalogue.
      if (seenKeys.has(converted.dedupeKey)) {
        duplicatesMerged += 1;
        continue;
      }
      const crossSource = accepted.find((other) => looksLikeDuplicate(other, converted));
      if (crossSource != null) {
        duplicatesMerged += 1;
        // Keep the better-attested copy rather than whichever arrived first.
        if (converted.description.length > crossSource.description.length) {
          crossSource.description = converted.description;
          crossSource.alsoSeenIn = [...new Set([...(crossSource.alsoSeenIn ?? []), adapter.key])];
        }
        continue;
      }

      seenKeys.add(converted.dedupeKey);
      accepted.push(converted);
      acceptedHere += 1;
    }

    // A source that refused us, or broke, is not a source that had nothing.
    const declined = outcome.result.warnings.some((w) => /declining automated access/i.test(w));
    const broke = outcome.result.failed === true;

    report.sources.push({
      key: adapter.key,
      displayName: adapter.displayName,
      status: broke ? 'failed' : declined ? 'declined' : 'ok',
      pagesFetched: outcome.result.pagesFetched,
      rawOffers: outcome.result.offers.length,
      accepted: acceptedHere,
      rejected: [...rejected.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      duplicatesMerged,
      warnings: outcome.result.warnings,
    });
  }

  // Anything previously collected from a source that ran successfully this time,
  // and did not reappear, has ended. Sources that failed or were declined are
  // excluded — their absence is our problem, not the campaign's.
  const healthy = new Set(report.sources.filter((s) => s.status === 'ok' && s.accepted > 0).map((s) => s.key));
  const expired = existing.filter(
    (offer) =>
      healthy.has(offer.sourceRef.sourceKey) &&
      !seenKeys.has(offer.dedupeKey) &&
      (offer.validTill == null || offer.validTill > nowIso),
  );
  for (const offer of expired) offer.validTill = nowIso;
  report.expired = expired.length;

  const merged = mergeIntoCatalogue(existing, accepted, nowIso);
  await options.store.replaceAll(merged);
  await options.store.saveValidationCache();

  report.requests = collector.requests;
  report.blockedByRobots = collector.blocked;
  report.totalOffers = merged.length;
  report.finishedAt = new Date().toISOString();
  return report;
}

async function runAdapter(
  adapter: OfferSourceAdapter,
  fetchPage: (url: string) => Promise<import('./http.ts').FetchedPage>,
  log: (message: string) => void,
  maxPages: number,
): Promise<SourceOutcome> {
  try {
    const result = await adapter.collect({
      fetchPage,
      log: (message) => log(`[${adapter.key}] ${message}`),
      maxPages,
    });
    return { key: adapter.key, ok: true, result };
  } catch (error) {
    // One adapter throwing must not cost the run its other sources.
    return { key: adapter.key, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Raw text → a structured, rankable offer, or a rejection reason.
 *
 * The rejection strings are deliberately few and coarse: they are counted and
 * reported, and a hundred distinct messages would be a log rather than a signal
 * about which parsing pattern to improve next.
 */
function normalise(raw: RawOffer, adapter: OfferSourceAdapter, nowIso: string): CatalogueOffer | string {
  const merchant = raw.merchant.trim();
  const terms = parseTerms(`${raw.title}\n${raw.description}`);

  const isBogo = /buy one get one|\bbogo\b/i.test(`${raw.title} ${raw.description}`);

  // "0% EMI" contains a percentage, and it is not a discount — it is a
  // financing rate. Reading it as a benefit produced a zero-value offer that
  // was then dropped, which is how the entire EMI catalogue went missing.
  const discountPercent = terms.percent != null && terms.percent > 0 ? terms.percent : null;

  // An interest-free EMI plan is a real, findable offer with **no discount**.
  // It changes when you pay, not what it costs, so it is admitted with a zero
  // benefit rather than rejected — and the optimizer then correctly credits it
  // with saving nothing.
  const isEmiOnly = discountPercent == null && terms.flatBenefit == null && terms.interestFreeEmi;

  const benefitType = isBogo
    ? 'bogo'
    : discountPercent != null
      ? 'percent'
      : terms.flatBenefit != null || isEmiOnly
        ? 'flat'
        : null;
  if (benefitType == null) return 'no readable discount or cashback figure';

  // `bogo` carries its own arithmetic in the domain layer, where it is bounded
  // and labelled an estimate; the 50 here is only a stable dedupe input.
  const value = isBogo ? 50 : isEmiOnly ? 0 : (discountPercent ?? terms.flatBenefit ?? 0);
  if (value < 0) return 'benefit parsed as negative';
  if (value === 0 && !isEmiOnly) return 'benefit parsed as zero';
  if (benefitType === 'percent' && value > 100) return 'percentage above 100 — almost certainly a misparse';

  // Three passes, most specific first: the source's own label, then the shop
  // name against the app's directory of Bangladeshi chains, then the offer copy
  // itself. The third matters more than it looks — City Bank's regional pages
  // label every offer with a *city*, so without reading "15% SAVINGS ON ALL
  // FOOD" a hundred restaurants would sit in `other`, unreachable from "I want
  // dinner".
  const labelled = normaliseCategory(raw.categoryLabel);
  const category =
    labelled !== 'other'
      ? labelled
      : (categoriseShop(merchant) ?? normaliseCategory(`${raw.title} ${raw.description}`));
  const window = parseDuration(raw.validityText);
  const mode = terms.mode ?? 'discount';

  const eligibility = buildEligibility(raw, adapter);

  return {
    dedupeKey: dedupeKeyFor({
      sourceKey: adapter.key,
      provider: adapter.provider,
      merchant,
      category,
      benefitType,
      value,
    }),
    provider: adapter.provider,
    instrument: adapter.instrument,
    category,
    mode,
    benefitType,
    value,
    // 0 means uncapped, and the parser returning null means "the text did not
    // say" — which for a cap is the same thing as uncapped, and for a minimum
    // is the same thing as no minimum.
    maxBenefit: terms.maxBenefit ?? 0,
    minSpend: terms.minSpend ?? 0,
    title: raw.title.slice(0, 140),
    description: raw.description.slice(0, 2_000),
    merchants: merchant === '' ? [] : [merchant],
    // The provider's display name, not its key: "Pay with your citybank card"
    // is what a database says, not what a person says.
    payWith: payWithSentence(adapter),
    terms: raw.description.slice(0, 2_000),
    // The published campaign window, where the source states one. Without it an
    // offer can never expire on its own, and a campaign that ended in September
    // would still be recommended in December wearing a "Verified" badge.
    validFrom: window.from,
    validTill: window.till,
    isSample: false,
    // §13: the source said nothing about combining, so nothing may be combined.
    stackable: undefined,
    benefitIsUpperBound: terms.benefitIsUpperBound,
    eligibility: withPromoCode(eligibility, terms.promoCode),
    limits: terms.maxSpend != null ? { maxSpend: terms.maxSpend } : undefined,
    emi:
      terms.emiTenures.length > 0
        ? { tenures: terms.emiTenures, interestFree: terms.interestFreeEmi }
        : isEmiOnly
          ? // The gallery pages say "0% EMI" without naming tenures. These are
            // the tenures every City Bank card supports; the plan is real even
            // when the page does not enumerate it.
            { tenures: [3, 6, 9, 12, 18, 24], interestFree: true }
          : undefined,
    sourceRef: {
      sourceKey: adapter.key,
      sourceName: adapter.displayName,
      sourceUrl: raw.sourceUrl,
      collectedAt: nowIso,
    },
    lastVerifiedAt: nowIso,
    firstSeenAt: nowIso,
  };
}

/**
 * A coupon code is an eligibility condition, not a footnote.
 *
 * Without the code typed at checkout the discount does not apply, so it belongs
 * where the engine will surface it as a caveat on the recommendation rather
 * than buried in the terms text nobody reads at a counter.
 */
function withPromoCode(
  eligibility: CatalogueOffer['eligibility'],
  promoCode: string | null,
): CatalogueOffer['eligibility'] {
  if (promoCode == null) return eligibility;
  return { ...(eligibility ?? {}), promoCode };
}

/** The instruction the user follows at the counter. */
function payWithSentence(adapter: OfferSourceAdapter): string {
  const label = findProvider(adapter.provider)?.label ?? adapter.provider;
  return adapter.instrument === 'mfs' ? `Pay with ${label}` : `Pay with your ${label} card`;
}

function buildEligibility(raw: RawOffer, adapter: OfferSourceAdapter): CatalogueOffer['eligibility'] {
  const eligibility: NonNullable<CatalogueOffer['eligibility']> = {};

  if (adapter.key === 'citybank_web' && raw.eligibilityText !== '') {
    // Resolved by the adapter, which owns this issuer's tier vocabulary.
    const { keys } = cardKeysFrom(raw.eligibilityText);
    if (keys.length > 0) eligibility.cardProductKeys = keys;
    if (/american express|amex/i.test(raw.eligibilityText)) eligibility.networks = ['amex'];
  }

  if (raw.locationText !== '') {
    const city = ['Dhaka', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi'].find((c) =>
      raw.locationText.toLowerCase().includes(c.toLowerCase()),
    );
    if (city != null) eligibility.cities = [city];
  }

  return Object.keys(eligibility).length > 0 ? eligibility : undefined;
}

/**
 * Fold a fresh crawl into what is already stored.
 *
 * An offer that reappears keeps its `firstSeenAt` and gets a new
 * `lastVerifiedAt`. That pair is what §15's confidence badge reads, and losing
 * the first-seen date would reset every campaign's history on every run.
 */
function mergeIntoCatalogue(
  existing: readonly CatalogueOffer[],
  fresh: readonly CatalogueOffer[],
  nowIso: string,
): CatalogueOffer[] {
  const byKey = new Map(existing.map((offer) => [offer.dedupeKey, offer]));

  for (const offer of fresh) {
    const previous = byKey.get(offer.dedupeKey);
    if (previous == null) {
      byKey.set(offer.dedupeKey, offer);
      continue;
    }
    byKey.set(offer.dedupeKey, {
      ...offer,
      firstSeenAt: previous.firstSeenAt,
      lastVerifiedAt: nowIso,
      // A campaign that came back was not really over.
      validTill: null,
    });
  }

  return [...byKey.values()];
}

/** A one-screen summary of a run, for the operator. */
export function formatReport(report: RunReport): string {
  const lines: string[] = [
    `Offer ingestion ${report.startedAt} → ${report.finishedAt}`,
    `${String(report.requests)} requests · ${String(report.totalOffers)} offers in catalogue · ${String(report.expired)} newly expired`,
    '',
  ];

  for (const source of report.sources) {
    lines.push(
      `${source.status === 'ok' ? '✓' : source.status === 'declined' ? '⊘' : '✗'} ${source.displayName} (${source.key})`,
      `   ${String(source.pagesFetched)} pages · ${String(source.rawOffers)} raw · ${String(source.accepted)} accepted · ${String(source.duplicatesMerged)} duplicates`,
    );
    for (const { reason, count } of source.rejected) lines.push(`   dropped ${String(count)}: ${reason}`);
    for (const warning of source.warnings) lines.push(`   ! ${warning}`);
    lines.push('');
  }

  if (report.blockedByRobots.length > 0) {
    lines.push(`robots.txt blocked ${String(report.blockedByRobots.length)} URLs:`);
    for (const url of report.blockedByRobots.slice(0, 10)) lines.push(`   ${url}`);
  }

  return lines.join('\n');
}

// ─── One-off scans ───────────────────────────────────────────────────────────

export type ScanResult = {
  url: string;
  /** Offers read from the page, normalised but **not** stored. */
  offers: CatalogueOffer[];
  pagesFetched: number;
  /** Candidate blocks that were read but produced nothing bookable. */
  rejected: { reason: string; count: number }[];
  warnings: string[];
  blockedByRobots: string[];
  /** Set when the page itself could not be read at all. */
  error: string | null;
};

/**
 * Scan one URL the user pasted, and hand back what it found.
 *
 * Deliberately does **not** write to the catalogue. A scan is one person's
 * guess at a page, run once, against a site nobody has vetted — folding that
 * into the shared catalogue would let a single bad link poison the data every
 * recommendation is built on. The client is given the rows and decides which,
 * if any, to keep.
 *
 * Everything else is shared with a scheduled run on purpose: the same polite
 * fetcher, the same robots.txt check, the same normalisation. A scanned offer
 * is therefore subject to exactly the rules a collected one is, and a parser
 * improvement helps both.
 */
export async function scanUrl(options: {
  url: string;
  follow?: boolean;
  maxPages?: number;
  nowIso?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<ScanResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const log = options.log ?? ((): void => undefined);

  let target: URL;
  try {
    target = new URL(options.url.trim());
  } catch {
    return emptyScan(options.url, 'That does not look like a web address.');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return emptyScan(options.url, 'Only http and https links can be scanned.');
  }

  const adapter = createGenericAdapter({ url: target.toString(), ...(options.follow != null ? { follow: options.follow } : {}) });
  const collector = createCollector({
    ...(options.fetchImpl != null ? { fetchImpl: options.fetchImpl } : {}),
    log,
  });

  const result = await adapter.collect({
    fetchPage: collector.fetchPage,
    log,
    maxPages: options.maxPages ?? 6,
  });

  const offers: CatalogueOffer[] = [];
  const rejections = new Map<string, number>();

  for (const raw of result.offers) {
    const normalised = normalise(raw, adapter, nowIso);
    if (typeof normalised === 'string') {
      rejections.set(normalised, (rejections.get(normalised) ?? 0) + 1);
      continue;
    }
    // Two blocks describing the same promotion is the normal case on a page
    // that lists an offer in a card and again in a detail panel.
    if (offers.some((existing) => looksLikeDuplicate(existing, normalised))) continue;
    offers.push(normalised);
  }

  return {
    url: target.toString(),
    offers,
    pagesFetched: result.pagesFetched,
    rejected: [...rejections].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    warnings: result.warnings,
    blockedByRobots: collector.blocked,
    error: result.failed === true ? (result.warnings[0] ?? 'The page could not be read.') : null,
  };
}

function emptyScan(url: string, error: string): ScanResult {
  return { url, offers: [], pagesFetched: 0, rejected: [], warnings: [], blockedByRobots: [], error };
}
