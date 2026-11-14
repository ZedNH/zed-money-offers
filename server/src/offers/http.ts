/**
 * The polite fetcher.
 *
 * Every request the ingestion pipeline makes goes through here, and it is the
 * only place that touches the network. That concentration is the point: the
 * rules below are easy to state once and impossible to enforce if each adapter
 * calls `fetch` itself.
 *
 *  - **robots.txt is checked before every request**, not once per run — an
 *    adapter that discovers a link is subject to the same policy as its seeds.
 *  - **One request at a time per origin**, with a delay between them, honouring
 *    `Crawl-delay` when the site states one. These are small sites; a burst of
 *    parallel requests is rude and gets the collector blocked, which is the same
 *    outcome as not building it.
 *  - **Conditional GET.** ETag and Last-Modified are remembered, so a nightly
 *    run that finds nothing changed costs the source one 304 per page.
 *  - **An identifying user agent with a contact URL.** An operator who wants
 *    this to stop must be able to work out who to ask.
 *
 * The failure mode is always "return a page marked failed", never "throw and
 * abandon the run".
 */

import { isAllowed, robotsFor } from './robots.ts';

export const USER_AGENT =
  process.env['OFFER_COLLECTOR_UA'] ??
  'ZedMoneyOfferCollector/0.1 (personal finance app; +https://github.com/zed-money/zed-money)';

/** Floor on the gap between requests to one origin, even when robots is silent. */
const DEFAULT_DELAY_MS = 1_500;

/**
 * How long one request may take.
 *
 * Sixty seconds, not twenty. The original budget was picked for HTML pages of a
 * few hundred kilobytes; the bKash brand feed is a **12 MB** JSON document, and
 * when the machine was also starting a dev server the fetch exceeded twenty
 * seconds and twenty thousand offers silently went missing. A page and a bulk
 * feed are not the same request and should not share a deadline.
 */
const REQUEST_TIMEOUT_MS = Number(process.env['OFFER_REQUEST_TIMEOUT_MS'] ?? 60_000);

/**
 * Retries, for the failures that are worth retrying — and only those.
 *
 * Three categories, treated differently on purpose:
 *
 *  - **Timeouts and dropped connections** are transient. A busy machine or a
 *    moment of packet loss should not cost an entire source.
 *  - **5xx** is the server failing, not refusing. Observed in practice: the
 *    12 MB bKash feed answered 500 once and took twenty thousand offers with
 *    it, while the identical request succeeded a minute earlier. Retried after
 *    a pause.
 *  - **4xx is never retried.** A 404 is a 404; a 403 or 429 is a refusal, and
 *    hammering it is both rude and the fastest way to get blocked outright.
 */
const RETRYABLE_ATTEMPTS = 3;

async function withRetry(attempt: () => Promise<Response>, sleep: (ms: number) => Promise<void>): Promise<Response> {
  let lastError: unknown = null;

  for (let tries = 0; tries < RETRYABLE_ATTEMPTS; tries++) {
    if (tries > 0) await sleep(2_000 * tries);

    try {
      const response = await attempt();
      if (response.status < 500) return response;
      // Server-side failure. Keep the response in case this was the last go.
      if (tries === RETRYABLE_ATTEMPTS - 1) return response;
    } catch (error) {
      const transient =
        error instanceof Error &&
        (error.name === 'TimeoutError' ||
          error.name === 'AbortError' ||
          /fetch failed|network|ECONN|ETIMEDOUT|socket hang up/i.test(error.message));
      if (!transient) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed after retries');
}

export type FetchedPage = {
  url: string;
  status: number;
  /** Empty on a 304 or a failure. */
  body: string;
  contentType: string;
  ok: boolean;
  /** True when the source confirmed nothing has changed since last time. */
  notModified: boolean;
  /** Why this page has no body. `null` when it does. */
  problem: string | null;
  fetchedAt: string;
};

type CacheEntry = { etag?: string; lastModified?: string };

export type Collector = {
  fetchPage: (url: string) => Promise<FetchedPage>;
  /** Total network requests made, for the run report. */
  requests: number;
  /** Pages skipped because robots.txt disallowed them. */
  blocked: string[];
};

/**
 * Build a collector.
 *
 * `validationCache` persists between runs when the caller hands one in — that
 * is what makes the conditional GETs worth anything.
 */
export function createCollector(options: {
  validationCache?: Map<string, CacheEntry>;
  fetchImpl?: typeof fetch;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
} = {}): Collector {
  const validation = options.validationCache ?? new Map<string, CacheEntry>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((): void => undefined);

  // One promise chain per origin serialises requests to that host without
  // serialising the whole run — two different sources still progress together.
  const originQueues = new Map<string, Promise<void>>();
  const lastRequestAt = new Map<string, number>();

  const collector: Collector = {
    requests: 0,
    blocked: [],
    fetchPage: async (url: string): Promise<FetchedPage> => {
      const parsed = safeUrl(url);
      if (parsed == null) return failed(url, 'not a valid absolute http(s) URL');

      const origin = parsed.origin;
      const rules = await robotsFor(origin, USER_AGENT, fetchImpl);

      if (rules.unreachable) {
        collector.blocked.push(url);
        return failed(url, `${origin}/robots.txt could not be read — not crawling on a guess`);
      }
      if (!isAllowed(rules, parsed.pathname)) {
        collector.blocked.push(url);
        return failed(url, `robots.txt disallows ${parsed.pathname}`);
      }

      const delayMs = Math.max(DEFAULT_DELAY_MS, (rules.crawlDelaySeconds ?? 0) * 1000);

      // Queue behind anything already in flight for this origin.
      const previous = originQueues.get(origin) ?? Promise.resolve();
      let release: () => void = () => undefined;
      originQueues.set(
        origin,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      await previous;

      try {
        const since = Date.now() - (lastRequestAt.get(origin) ?? 0);
        if (since < delayMs) await sleep(delayMs - since);
        lastRequestAt.set(origin, Date.now());

        const cached = validation.get(url);
        const headers: Record<string, string> = {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'en,bn;q=0.8',
        };
        if (cached?.etag != null) headers['if-none-match'] = cached.etag;
        if (cached?.lastModified != null) headers['if-modified-since'] = cached.lastModified;

        collector.requests += 1;
        const response = await withRetry(
          () => fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
          sleep,
        );
        const fetchedAt = new Date().toISOString();

        if (response.status === 304) {
          log(`304 unchanged ${url}`);
          return {
            url, status: 304, body: '', contentType: '', ok: true,
            notModified: true, problem: null, fetchedAt,
          };
        }

        if (!response.ok) {
          return { ...failed(url, `HTTP ${String(response.status)}`), status: response.status, fetchedAt };
        }

        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        if (etag != null || lastModified != null) {
          validation.set(url, {
            ...(etag != null ? { etag } : {}),
            ...(lastModified != null ? { lastModified } : {}),
          });
        }

        return {
          url,
          status: response.status,
          body: await response.text(),
          contentType: response.headers.get('content-type') ?? '',
          ok: true,
          notModified: false,
          problem: null,
          fetchedAt,
        };
      } catch (error) {
        return failed(url, error instanceof Error ? error.message : String(error));
      } finally {
        release();
      }
    },
  };

  return collector;
}

function failed(url: string, problem: string): FetchedPage {
  return {
    url,
    status: 0,
    body: '',
    contentType: '',
    ok: false,
    notModified: false,
    problem,
    fetchedAt: new Date().toISOString(),
  };
}

function safeUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
}
