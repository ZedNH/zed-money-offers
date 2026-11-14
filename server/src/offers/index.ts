/**
 * The offer service: the registry of sources, the HTTP surface the app syncs
 * from, and the CLI entry point.
 *
 * Adding a provider is one import and one array entry. That is the payoff for
 * the adapter contract, and it is what §26 ("design the system so additional
 * sources can be added later") is asking for.
 */

import { bkashOfferFinderAdapter } from './adapters/bkash-offer-finder.ts';
import { cityBankAdapter } from './adapters/citybank.ts';
import { bdProviderAdapters } from './adapters/bd-providers.ts';
import type { OfferSourceAdapter } from './adapter.ts';
import { formatReport, runIngestion, type RunReport } from './pipeline.ts';
import { createFileStore, type CatalogueOffer, type OfferStore } from './store.ts';

export const ADAPTERS: readonly OfferSourceAdapter[] = [cityBankAdapter, bkashOfferFinderAdapter, ...bdProviderAdapters];

export const OFFER_DATA_DIR = process.env['OFFER_DATA_DIR'] ?? './data/offers';

let store: OfferStore | null = null;
export function offerStore(): OfferStore {
  store ??= createFileStore(OFFER_DATA_DIR);
  return store;
}

/** Kick off a collection run across every registered source. */
export async function refreshOffers(log: (message: string) => void = console.log): Promise<RunReport> {
  return runIngestion({ adapters: ADAPTERS, store: offerStore(), log });
}

/**
 * Refresh in the background when the catalogue has gone stale.
 *
 * The reference implementation re-scrapes on *every* page load. That guarantees
 * freshness and it also means twenty people opening the app at once send twenty
 * crawls at the sources — which is how a collector gets blocked, and the block
 * costs far more freshness than it buys.
 *
 * So: the same idea with two guards. One run at a time, and only if the last
 * one finished more than `OFFER_MAX_AGE_HOURS` ago. The request that triggers
 * it does not wait — it is answered from what is already there, and the next
 * one gets the new data. Offers change over days; nobody needs the refresh to
 * block their page load.
 */
const MAX_AGE_HOURS = Number(process.env['OFFER_MAX_AGE_HOURS'] ?? 12);

let refreshInFlight: Promise<RunReport> | null = null;

export async function refreshIfStale(log: (message: string) => void = console.log): Promise<'started' | 'fresh' | 'busy'> {
  if (refreshInFlight != null) return 'busy';

  const updatedAt = await offerStore().lastUpdatedAt();
  if (updatedAt != null) {
    const ageHours = (Date.now() - Date.parse(updatedAt)) / 3_600_000;
    if (ageHours < MAX_AGE_HOURS) return 'fresh';
  }

  log(`catalogue is stale — refreshing in the background`);
  refreshInFlight = refreshOffers(log)
    .then((report) => {
      log(`background refresh done: ${String(report.totalOffers)} offers`);
      return report;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  // Deliberately not awaited by the caller.
  refreshInFlight.catch((error: unknown) => {
    log(`background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  return 'started';
}

/** True while a collection run is in progress, for the client's status line. */
export function isRefreshing(): boolean {
  return refreshInFlight != null;
}

/**
 * The catalogue as the client wants it.
 *
 * Expired rows are included on purpose. §16's "is this a good offer or should I
 * wait?" is answered from history, and the client cannot build history it was
 * never sent. They carry an end date, so the confidence layer marks them
 * expired and the optimizer will not recommend them.
 */
export type CataloguePayload = {
  updatedAt: string | null;
  /** True while a background collection run is under way. */
  refreshing: boolean;
  count: number;
  sources: { key: string; displayName: string; termsUrl?: string }[];
  offers: CatalogueOffer[];
};

export async function cataloguePayload(): Promise<CataloguePayload> {
  const current = offerStore();
  const offers = await current.all();
  return {
    updatedAt: await current.lastUpdatedAt(),
    refreshing: isRefreshing(),
    count: offers.length,
    sources: ADAPTERS.map((a) => ({
      key: a.key,
      displayName: a.displayName,
      ...(a.termsUrl != null ? { termsUrl: a.termsUrl } : {}),
    })),
    offers,
  };
}

export { formatReport, runIngestion };
export type { RunReport, CatalogueOffer, OfferStore };
