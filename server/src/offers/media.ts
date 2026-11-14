/**
 * Offers printed in pictures and PDFs.
 *
 * Many banks publish a campaign only as a banner image ("20% off at Sultan's
 * Dine with BRAC cards") or a PDF of terms. The page's own text then has no
 * figure in it, and the reader rightly finds nothing. This reads those
 * pictures with Tesseract OCR and the PDFs with pdftotext, and hands the words
 * back to the same reader every page goes through — so a guess is never
 * dressed up as an offer: no readable discount, no row.
 *
 * Only runs where the tools exist and `OFFER_OCR=1` (the daily GitHub job
 * installs them); elsewhere it quietly does nothing.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Words in a file's address or alt text that say it is about an offer. */
const OFFER_WORDS = /offer|discount|promo|campaign|cashback|deal|bogo|privilege|partner|emi|off\b|sale|%/i;
/** Pictures that are never offers. */
const NOT_OFFER = /logo|icon|favicon|sprite|avatar|banner-?bg|background|placeholder|loader|arrow|social|facebook|twitter|linkedin|youtube|instagram|app-?store|google-?play|qr/i;

const MAX_PER_SOURCE = Number(process.env['OFFER_OCR_MAX'] ?? 30);
const MAX_BYTES = 4 * 1024 * 1024;

export function mediaEnabled(): boolean {
  return process.env['OFFER_OCR'] === '1';
}

export type MediaLink = { url: string; kind: 'image' | 'pdf'; hint: string };

/** Offer-looking images and PDFs a page links to or shows. */
export function mediaLinks(html: string, baseUrl: string): MediaLink[] {
  const out = new Map<string, MediaLink>();
  const add = (raw: string | undefined, kind: MediaLink['kind'], hint: string): void => {
    if (raw == null || raw.startsWith('data:')) return;
    let url: string;
    try {
      url = new URL(raw, baseUrl).toString();
    } catch {
      return;
    }
    if (NOT_OFFER.test(url) || out.has(url)) return;
    if (!OFFER_WORDS.test(`${url} ${hint}`)) return;
    out.set(url, { url, kind, hint });
  };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag)?.[1];
    const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (src != null && /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(src)) add(src, 'image', alt);
  }
  for (const m of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    add(m[1], 'pdf', (m[2] ?? '').replace(/<[^>]+>/g, ' '));
  }
  return [...out.values()];
}

let toolsChecked: Promise<{ ocr: boolean; pdf: boolean }> | null = null;
function tools(): Promise<{ ocr: boolean; pdf: boolean }> {
  toolsChecked ??= (async () => ({
    ocr: await run('tesseract', ['--version']).then(() => true, () => false),
    pdf: await run('pdftotext', ['-v']).then(() => true, () => false),
  }))();
  return toolsChecked;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The text in each picture or PDF, politely: one at a time, a second apart,
 * small files only. Returns the words found with the file they came from.
 */
export async function readMedia(links: readonly MediaLink[], log: (m: string) => void): Promise<{ url: string; text: string }[]> {
  if (!mediaEnabled() || links.length === 0) return [];
  const have = await tools();
  const usable = links.filter((l) => (l.kind === 'image' ? have.ocr : have.pdf)).slice(0, MAX_PER_SOURCE);
  if (usable.length === 0) return [];
  const dir = await mkdtemp(join(tmpdir(), 'zed-offer-'));
  const out: { url: string; text: string }[] = [];
  try {
    for (const [i, link] of usable.entries()) {
      try {
        const res = await fetch(link.url, { headers: { 'user-agent': 'ZedMoneyOffers/1.0 (+https://github.com/ZedNH/zed-money-offers)' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_BYTES) continue;
        const file = join(dir, `${String(i)}.${link.kind === 'pdf' ? 'pdf' : 'img'}`);
        await writeFile(file, bytes);
        const { stdout } =
          link.kind === 'pdf'
            ? await run('pdftotext', ['-layout', '-l', '6', file, '-'], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })
            : await run('tesseract', [file, '-', '-l', 'eng+ben', '--psm', '6'], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }).catch(() =>
                run('tesseract', [file, '-', '--psm', '6'], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }),
              );
        const text = stdout.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length >= 12) out.push({ url: link.url, text: text.slice(0, 6_000) });
      } catch {
        /* one unreadable file never stops the rest */
      }
      await sleep(1_000);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  log(`read ${String(out.length)} of ${String(usable.length)} offer pictures and PDFs`);
  return out;
}
