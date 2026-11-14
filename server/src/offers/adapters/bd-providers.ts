/**
 * Bangladesh's banks and mobile wallets, as offer sources.
 *
 * bKash and City Bank have adapters that know their sites. Nobody is going to
 * write (and keep fixing) one of those for fifty banks — and nobody has to:
 * every bank publishes its card offers on a page linked from its home page,
 * under a word like "offers", "discount partners" or "privileges". So a source
 * here is only *whose* site it is and where it starts. The adapter finds the
 * offer pages itself from the home page's links, then reads each one with the
 * source-agnostic reader (`generic.ts`), following the listing into the
 * individual offers.
 *
 * When a bank redesigns its site, nothing here changes unless it renames the
 * word in the link. A known-good listing address can be pinned in `listings`
 * for sites whose home page hides it behind a script.
 */

import type { AdapterContext, AdapterResult, OfferSourceAdapter, RawOffer } from '../adapter.ts';
import { sameOriginLinks } from '../extract.ts';
import { createGenericAdapter } from './generic.ts';

type Source = {
  /** The provider key the app knows the bank or wallet by. */
  provider: string;
  displayName: string;
  instrument: OfferSourceAdapter['instrument'];
  home: string;
  /** Listing pages known to work, tried before anything found on the home page. */
  listings?: readonly string[];
};

/** A link that leads to offers: the words banks actually use for the page. */
const LISTING = /offer|discount|privilege|promo|campaign|deal|lifestyle|partner|benefit|cashback|bogo|buy-?one/i;
/** …and the ones that only look like it. */
const NOT_LISTING = /career|tender|notice|news|report|investor|disclosure|sustainab|csr|\.pdf|\.jpe?g|\.png|login|complain|agent-banking|branch|atm|loan|deposit|foreign|remittance|interest-rate|schedule-of-charges/i;

const MAX_LISTINGS = 4;
/** Names that are parts of a web page, not shops. */
const FURNITURE = /^(?:accessibility options?|cookie|privacy|sign ?in|log ?in|menu|skip to|subscribe|newsletter|copyright|careers?|contact us|search|home)/i;

export const BD_SOURCES: readonly Source[] = [
  // ── Mobile wallets ──
  { provider: 'nagad', displayName: 'Nagad', instrument: 'mfs', home: 'https://nagad.com.bd/' },
  { provider: 'upay', displayName: 'Upay', instrument: 'mfs', home: 'https://www.upaybd.com/' },
  { provider: 'rocket', displayName: 'Rocket (DBBL)', instrument: 'mfs', home: 'https://www.dutchbanglabank.com/rocket/rocket.html' },
  { provider: 'tap', displayName: 'Tap', instrument: 'mfs', home: 'https://www.trustaxiatapay.com/' },
  // ── Banks: cards ──
  { provider: 'ebl', displayName: 'Eastern Bank', instrument: 'card', home: 'https://www.ebl.com.bd/', listings: ['https://www.ebl.com.bd/retail/EBL-Cards-Offers'] },
  { provider: 'brac', displayName: 'BRAC Bank', instrument: 'card', home: 'https://www.bracbank.com/en/', listings: ['https://www.bracbank.com/en/offers'] },
  { provider: 'mtb', displayName: 'Mutual Trust Bank', instrument: 'card', home: 'https://www.mutualtrustbank.com/', listings: ['https://www.mutualtrustbank.com/cards/card-offers/'] },
  { provider: 'scb', displayName: 'Standard Chartered', instrument: 'card', home: 'https://www.sc.com/bd/', listings: ['https://www.sc.com/bd/promotions/'] },
  { provider: 'ibbl', displayName: 'Islami Bank', instrument: 'card', home: 'https://www.islamibankbd.com/', listings: ['https://www.islamibankbd.com/offers'] },
  { provider: 'dbbl', displayName: 'Dutch-Bangla Bank', instrument: 'card', home: 'https://www.dutchbanglabank.com/' },
  { provider: 'ucb', displayName: 'United Commercial Bank', instrument: 'card', home: 'https://www.ucb.com.bd/' },
  { provider: 'sebl', displayName: 'Southeast Bank', instrument: 'card', home: 'https://www.southeastbank.com.bd/' },
  { provider: 'pubali', displayName: 'Pubali Bank', instrument: 'card', home: 'https://www.pubalibangla.com/' },
  { provider: 'prime', displayName: 'Prime Bank', instrument: 'card', home: 'https://www.primebank.com.bd/' },
  { provider: 'hsbc', displayName: 'HSBC', instrument: 'card', home: 'https://www.hsbc.com.bd/' },
  { provider: 'dhakabank', displayName: 'Dhaka Bank', instrument: 'card', home: 'https://dhakabank.com.bd/' },
  { provider: 'bankasia', displayName: 'Bank Asia', instrument: 'card', home: 'https://www.bankasia-bd.com/' },
  { provider: 'abbank', displayName: 'AB Bank', instrument: 'card', home: 'https://abbl.com/' },
  { provider: 'ncc', displayName: 'NCC Bank', instrument: 'card', home: 'https://www.nccbank.com.bd/' },
  { provider: 'onebank', displayName: 'ONE Bank', instrument: 'card', home: 'https://www.onebank.com.bd/' },
  { provider: 'trust', displayName: 'Trust Bank', instrument: 'card', home: 'https://www.tbl.com.bd/' },
  { provider: 'jamuna', displayName: 'Jamuna Bank', instrument: 'card', home: 'https://jamunabankbd.com/' },
  { provider: 'mercantile', displayName: 'Mercantile Bank', instrument: 'card', home: 'https://www.mblbd.com/' },
  { provider: 'premier', displayName: 'Premier Bank', instrument: 'card', home: 'https://premierbankltd.com/' },
  { provider: 'exim', displayName: 'EXIM Bank', instrument: 'card', home: 'https://www.eximbankbd.com/' },
  { provider: 'ific', displayName: 'IFIC Bank', instrument: 'card', home: 'https://www.ificbank.com.bd/' },
  { provider: 'alarafah', displayName: 'Al-Arafah Islami Bank', instrument: 'card', home: 'https://www.aibl.com.bd/' },
  { provider: 'shahjalal', displayName: 'Shahjalal Islami Bank', instrument: 'card', home: 'https://www.sjiblbd.com/' },
  { provider: 'sibl', displayName: 'Social Islami Bank', instrument: 'card', home: 'https://www.siblbd.com/' },
  { provider: 'standardbank', displayName: 'Standard Bank', instrument: 'card', home: 'https://www.standardbankbd.com/' },
  { provider: 'nrbc', displayName: 'NRBC Bank', instrument: 'card', home: 'https://www.nrbcommercialbank.com/' },
  { provider: 'midland', displayName: 'Midland Bank', instrument: 'card', home: 'https://www.midlandbankbd.net/' },
  { provider: 'meghna', displayName: 'Meghna Bank', instrument: 'card', home: 'https://www.meghnabank.com.bd/' },
  { provider: 'community', displayName: 'Community Bank', instrument: 'card', home: 'https://www.communitybankbd.com/' },
  { provider: 'lankabangla', displayName: 'LankaBangla Finance', instrument: 'card', home: 'https://www.lankabangla.com/' },
];

/** The offer pages a home page links to, most offer-like first. */
export function listingLinks(html: string, home: string): string[] {
  const score = (link: string): number => {
    const path = link.toLowerCase();
    return (/offer/.test(path) ? 4 : 0) + (/discount|privilege/.test(path) ? 3 : 0) + (/card/.test(path) ? 1 : 0) - path.split('/').length * 0.1;
  };
  return sameOriginLinks(html, home)
    .filter((link) => LISTING.test(new URL(link).pathname) && !NOT_LISTING.test(link))
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_LISTINGS * 2);
}

function adapterFor(source: Source): OfferSourceAdapter {
  return {
    key: `bd_${source.provider}`,
    displayName: source.displayName,
    provider: source.provider,
    instrument: source.instrument,
    seeds: [source.home, ...(source.listings ?? [])],
    collect: async (context: AdapterContext): Promise<AdapterResult> => {
      const warnings: string[] = [];
      let pagesFetched = 0;
      const listings = new Set<string>(source.listings ?? []);

      // The home page says where the offers are.
      const home = await context.fetchPage(source.home);
      pagesFetched += 1;
      if (home.ok && home.body !== '') {
        for (const link of listingLinks(home.body, source.home)) listings.add(link);
      } else {
        warnings.push(`${source.home}: ${home.problem ?? `status ${String(home.status)}`}`);
      }
      if (listings.size === 0) {
        context.log(`${source.displayName}: no offer page found from the home page`);
        return { offers: [], pagesFetched, warnings, failed: !home.ok };
      }

      const offers: RawOffer[] = [];
      let anyRead = false;
      const perListing = Math.max(2, Math.floor((context.maxPages - 1) / MAX_LISTINGS));
      for (const url of [...listings].slice(0, MAX_LISTINGS)) {
        const reader = createGenericAdapter({ url, follow: true, instrument: source.instrument });
        const result = await reader.collect({ ...context, maxPages: perListing });
        pagesFetched += result.pagesFetched;
        warnings.push(...result.warnings);
        if (result.failed !== true) anyRead = true;
        // Page furniture read as an offer ("Accessibility Options", a cookie notice) is dropped here.
        offers.push(...result.offers.filter((offer) => !FURNITURE.test(`${offer.merchant} ${offer.title}`.trim()) || /\d\s*%|tk|bdt|৳/i.test(offer.title)));
      }
      context.log(`${source.displayName}: ${String(offers.length)} candidate${offers.length === 1 ? '' : 's'} from ${String(Math.min(listings.size, MAX_LISTINGS))} page${listings.size === 1 ? '' : 's'}`);
      return { offers, pagesFetched, warnings, failed: !anyRead };
    },
  };
}

export const bdProviderAdapters: readonly OfferSourceAdapter[] = BD_SOURCES.map(adapterFor);
