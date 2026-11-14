/**
 * robots.txt: fetch, parse, and obey.
 *
 * The brief is explicit — "only collect information that is publicly accessible
 * and permitted by the source's terms/robots policies" — so this is a gate, not
 * a courtesy. Nothing in the ingestion pipeline can fetch a page without first
 * asking this module, and a source whose robots.txt disallows a path is skipped
 * with a warning in the run report rather than quietly fetched anyway.
 *
 * Two judgement calls worth stating, because both cut against convenience:
 *
 *  - **A missing robots.txt means allowed, an unreachable one means blocked.**
 *    A 404 is a site saying it has no restrictions. A 500 or a timeout is a site
 *    saying nothing at all, and guessing "allowed" from silence is how a crawler
 *    ends up somewhere it was told not to go during an outage.
 *  - **`Crawl-delay` is honoured even though it is not in the standard.** It is
 *    the only machine-readable way a site can ask us to slow down.
 *
 * No dependencies: this is a small, well-specified format and a parser for it is
 * shorter than the code to configure a library.
 */

export type RobotsRules = {
  /** Longest-match wins, per the de-facto standard. */
  rules: { path: string; allow: boolean }[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
  /** True when the file could not be read at all — treated as "do not crawl". */
  unreachable: boolean;
};

const EMPTY: RobotsRules = { rules: [], crawlDelaySeconds: null, sitemaps: [], unreachable: false };

/**
 * Parse a robots.txt body for one user-agent.
 *
 * Groups are matched most-specific-first: a block naming our agent wins over
 * `*`. Directives outside any group are ignored except `Sitemap`, which is
 * file-scoped by the specification.
 */
export function parseRobots(body: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const lines = body.split(/\r?\n/);

  const groups = new Map<string, { rules: { path: string; allow: boolean }[]; crawlDelay: number | null }>();
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  // A run of consecutive `User-agent` lines opens one shared group; the first
  // rule after them closes the run.
  let collectingAgents = false;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }

    if (field === 'user-agent') {
      if (!collectingAgents) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }

    collectingAgents = false;
    if (currentAgents.length === 0) continue;

    for (const agent of currentAgents) {
      const group = groups.get(agent) ?? { rules: [], crawlDelay: null };
      if (field === 'allow' || field === 'disallow') {
        // "Disallow:" with an empty value means allow everything — a common and
        // easily-misread idiom.
        if (value !== '' || field === 'allow') {
          group.rules.push({ path: value, allow: field === 'allow' });
        }
      } else if (field === 'crawl-delay') {
        const delay = Number(value);
        if (Number.isFinite(delay) && delay >= 0) group.crawlDelay = delay;
      }
      groups.set(agent, group);
    }
  }

  const chosen =
    [...groups.entries()].find(([agent]) => agent !== '*' && ua.includes(agent))?.[1] ?? groups.get('*') ?? null;

  if (chosen == null) return { ...EMPTY, sitemaps };
  return {
    rules: chosen.rules,
    crawlDelaySeconds: chosen.crawlDelay,
    sitemaps,
    unreachable: false,
  };
}

/**
 * Is this path allowed?
 *
 * Longest matching pattern wins; `Allow` beats `Disallow` at equal length,
 * which is what every major crawler does and what site operators write their
 * files expecting.
 */
export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  if (rules.unreachable) return false;

  let best: { length: number; allow: boolean } | null = null;
  for (const rule of rules.rules) {
    if (!matchesPattern(rule.path, pathname)) continue;
    if (best == null || rule.path.length > best.length || (rule.path.length === best.length && rule.allow)) {
      best = { length: rule.path.length, allow: rule.allow };
    }
  }
  return best?.allow ?? true;
}

/** robots.txt wildcards: `*` matches any run, `$` anchors the end. */
function matchesPattern(pattern: string, pathname: string): boolean {
  if (pattern === '') return false;
  if (!pattern.includes('*') && !pattern.endsWith('$')) return pathname.startsWith(pattern);

  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(pathname);
}

/**
 * Read and cache one origin's robots.txt.
 *
 * Cached for the life of the process: an ingestion run lasts minutes, and
 * re-fetching robots.txt before every page would itself be the impolite thing.
 */
const cache = new Map<string, RobotsRules>();

export async function robotsFor(
  origin: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached != null) return cached;

  let rules: RobotsRules;
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404 || response.status === 410) {
      // No file: the site has stated no restrictions.
      rules = { ...EMPTY };
    } else if (!response.ok) {
      // Present but unreadable. Silence is not consent.
      rules = { ...EMPTY, unreachable: true };
    } else {
      rules = parseRobots(await response.text(), userAgent);
    }
  } catch {
    rules = { ...EMPTY, unreachable: true };
  }

  cache.set(origin, rules);
  return rules;
}

/** Drop every cached decision. For tests, and for a long-lived process re-reading policy. */
export function clearRobotsCache(): void {
  cache.clear();
}
