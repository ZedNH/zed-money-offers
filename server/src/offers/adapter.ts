/**
 * The Offer Source Adapter contract (§2 of the Offer Intelligence brief).
 *
 * "Do not hard-code the system around the current HTML structure of these
 * websites." That instruction shapes everything here.
 *
 * An adapter's job is narrow: know *where* a source publishes its offers and
 * *what its vocabulary means*. It does not know how to fetch politely (that is
 * `http.ts`), how to read a percentage out of prose (`normalize.ts` in the
 * domain layer), whether an offer is a duplicate (`pipeline.ts`), or how the
 * catalogue is stored (`store.ts`). Adding City Bank's Visa range or a new MFS
 * operator means writing one small file against this interface and nothing else.
 *
 * Each adapter returns `RawOffer` — text and hints, not conclusions. The
 * conversion into a structured, arithmetic-ready `Offer` happens once, in the
 * shared normalisation stage, so every source is subject to the same rules and
 * a parsing improvement benefits all of them at once.
 */

import type { FetchedPage } from './http.ts';

/**
 * What a source yields before normalisation.
 *
 * The prose fields are kept verbatim. That is deliberate: the parser is
 * conservative and will fail to read some phrasings, and when it does, the
 * original sentence is what a human needs to see in order to fix the pattern —
 * or to decide for themselves whether the offer applies.
 */
export type RawOffer = {
  /** The merchant, as the source names it. Empty for a category-wide campaign. */
  merchant: string;
  /** The source's own category word, e.g. "Dining", "Food & Beverage". */
  categoryLabel: string;
  /** Headline, as published. */
  title: string;
  /** The full offer text — this is what the term parser reads. */
  description: string;
  /** Card names, tiers or wallet names the source lists as eligible, verbatim. */
  eligibilityText: string;
  /** Branch addresses or city names, verbatim. */
  locationText: string;
  /** Anything the source presents as validity. Frequently absent. */
  validityText: string;
  /** The page this came from, so every row can be traced back. */
  sourceUrl: string;
};

export type AdapterContext = {
  /** Fetch a page through the polite, robots-checked, rate-limited client. */
  fetchPage: (url: string) => Promise<FetchedPage>;
  /** Emit progress. Adapters must not write to the console directly. */
  log: (message: string) => void;
  /** Hard ceiling on pages one run may fetch from this source. */
  maxPages: number;
};

export type AdapterResult = {
  offers: RawOffer[];
  /** Pages actually fetched, for the run report. */
  pagesFetched: number;
  /**
   * Anything the adapter could not do. Surfaced in the run report rather than
   * thrown: one broken sub-page must not discard a source's other 200 offers.
   */
  warnings: string[];
  /**
   * Set when the source's *primary* path failed, as opposed to yielding nothing.
   *
   * The distinction decides whether the pipeline expires this source's existing
   * offers. A source that genuinely has no campaigns this month should retire
   * the old ones; a source that answered 500 should not, or one bad request
   * would wipe twenty thousand rows and report it as an empty month.
   */
  failed?: boolean;
};

export type OfferSourceAdapter = {
  /** Stable key. Becomes part of every offer's dedupe key, so it must never change. */
  key: string;
  /** Shown to the user beside every offer this source produced. */
  displayName: string;
  /** The provider whose offers this source publishes. */
  provider: string;
  /**
   * The instrument these offers apply to. A bank's campaign page is about its
   * cards; a wallet's is about the wallet.
   */
  instrument: 'mfs' | 'credit_card' | 'debit_card' | 'card' | 'any';
  /** Where the source's terms live, for the operator to read before enabling it. */
  termsUrl?: string;
  /** Entry points. The adapter may discover more from these. */
  seeds: readonly string[];
  collect: (context: AdapterContext) => Promise<AdapterResult>;
};

/** An adapter can fail entirely without taking the run down. */
export type SourceOutcome =
  | { key: string; ok: true; result: AdapterResult }
  | { key: string; ok: false; error: string };
