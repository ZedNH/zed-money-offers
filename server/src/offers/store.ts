/**
 * The offer catalogue store.
 *
 * A JSON file on disk, deliberately. The catalogue is small — hundreds of rows,
 * not millions — it is written once per ingestion run and read on every client
 * sync, and it needs to be trivially inspectable by whoever is operating the
 * collector. A database would add an operational dependency to a service whose
 * whole job is "fetch some pages and write a list".
 *
 * Writes are atomic: a temporary file plus a rename, so a crash mid-write leaves
 * the previous catalogue intact rather than a truncated one. A half-written
 * catalogue would surface as offers silently disappearing from the app.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * An offer as stored.
 *
 * Structurally the client's `Offer` with the collector's own bookkeeping added:
 * `dedupeKey` for identity across runs, `firstSeenAt` for §16's history, and
 * `alsoSeenIn` when more than one source published the same campaign.
 */
export type CatalogueOffer = {
  dedupeKey: string;
  provider: string;
  instrument: 'mfs' | 'credit_card' | 'debit_card' | 'card' | 'any';
  category: string;
  mode: 'discount' | 'cashback';
  benefitType: 'percent' | 'flat' | 'bogo';
  value: number;
  maxBenefit: number;
  minSpend: number;
  title: string;
  description: string;
  merchants: string[];
  payWith: string;
  terms?: string;
  validFrom: string | null;
  validTill: string | null;
  isSample: boolean;
  stackable?: boolean;
  /** The published figure is a ceiling — "up to ৳200 off" — not a promise. */
  benefitIsUpperBound?: boolean;
  eligibility?: {
    cardProductKeys?: string[];
    networks?: string[];
    rails?: string[];
    cities?: string[];
    promoCode?: string;
    newUsersOnly?: boolean;
    selectedUsersOnly?: boolean;
  };
  limits?: { maxSpend?: number; usesAllowed?: number; perTransactionBenefit?: number };
  emi?: { tenures: number[]; interestFree: boolean; flatAnnualRate?: number };
  sourceRef: {
    sourceKey: string;
    sourceName: string;
    sourceUrl?: string;
    collectedAt?: string;
  };
  lastVerifiedAt: string;
  firstSeenAt: string;
  /** Other sources that published the same campaign. */
  alsoSeenIn?: string[];
};

export type OfferStore = {
  all: () => Promise<CatalogueOffer[]>;
  replaceAll: (offers: readonly CatalogueOffer[]) => Promise<void>;
  /** ETag / Last-Modified per URL, so a nightly run costs the sources 304s. */
  validationCache: () => Promise<Map<string, { etag?: string; lastModified?: string }>>;
  saveValidationCache: () => Promise<void>;
  /** When the catalogue was last written. Sent to clients so they can skip a sync. */
  lastUpdatedAt: () => Promise<string | null>;
};

type CatalogueFile = {
  version: 1;
  updatedAt: string;
  offers: CatalogueOffer[];
};

export function createFileStore(directory: string): OfferStore {
  const cataloguePath = join(directory, 'catalogue.json');
  const cachePath = join(directory, 'http-cache.json');

  let cache: Map<string, { etag?: string; lastModified?: string }> | null = null;

  return {
    async all(): Promise<CatalogueOffer[]> {
      const file = await readJson<CatalogueFile>(cataloguePath);
      return file?.offers ?? [];
    },

    async replaceAll(offers: readonly CatalogueOffer[]): Promise<void> {
      const file: CatalogueFile = { version: 1, updatedAt: new Date().toISOString(), offers: [...offers] };
      await writeJsonAtomic(cataloguePath, file);
    },

    async validationCache(): Promise<Map<string, { etag?: string; lastModified?: string }>> {
      if (cache != null) return cache;
      const stored = await readJson<Record<string, { etag?: string; lastModified?: string }>>(cachePath);
      cache = new Map(Object.entries(stored ?? {}));
      return cache;
    },

    async saveValidationCache(): Promise<void> {
      if (cache == null) return;
      await writeJsonAtomic(cachePath, Object.fromEntries(cache));
    },

    async lastUpdatedAt(): Promise<string | null> {
      const file = await readJson<CatalogueFile>(cataloguePath);
      return file?.updatedAt ?? null;
    },
  };
}

/** An in-memory store, for tests and for a dry run. */
export function createMemoryStore(initial: readonly CatalogueOffer[] = []): OfferStore {
  let offers = [...initial];
  const cache = new Map<string, { etag?: string; lastModified?: string }>();
  let updatedAt: string | null = null;

  return {
    all: () => Promise.resolve(offers),
    replaceAll: (next) => {
      offers = [...next];
      updatedAt = new Date().toISOString();
      return Promise.resolve();
    },
    validationCache: () => Promise.resolve(cache),
    saveValidationCache: () => Promise.resolve(),
    lastUpdatedAt: () => Promise.resolve(updatedAt),
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    // Missing or corrupt. A corrupt catalogue is recoverable — the next run
    // rebuilds it — so this returns null rather than taking the process down.
    return null;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, path);
}
