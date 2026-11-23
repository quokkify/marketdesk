// Loads public OLX search pages: one request at a time for the whole process, a pause after each,
// no cookies, redirects only within the base host. Rejects on any failure; the caller decides.

import type { IOlxSearch, OlxSearchPage } from '../../application/ports/IOlxSearch';
import { olxSearchUrl, parseOlxSearchPage } from './olxSearchPage';

export const MAX_PAGES = 10;
export const PAGE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const DEFAULT_BASE_URL = 'https://www.olx.pl';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function loadOlxSearchBaseUrl(): string {
  const raw = (process.env.OLX_SEARCH_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OLX_SEARCH_BASE_URL must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OLX_SEARCH_BASE_URL must be an http(s) URL');
  }
  return raw.replace(/\/+$/, '');
}

interface Deps {
  baseUrl: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class OlxSearchPageClient implements IOlxSearch {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly baseHost: string;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
    this.timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.baseHost = new URL(deps.baseUrl).host;
  }

  page(query: string, page: number, signal: AbortSignal): Promise<OlxSearchPage> {
    const url = olxSearchUrl(this.deps.baseUrl, query, page);
    const run = this.tail.then(() => this.load(url, signal));
    this.tail = run.then(
      () => this.sleep(PAGE_DELAY_MS),
      () => this.sleep(PAGE_DELAY_MS)
    );
    return run;
  }

  private async load(startUrl: string, signal: AbortSignal): Promise<OlxSearchPage> {
    if (signal.aborted) throw new Error('OLX search aborted');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      const html = await this.fetchHtml(startUrl, controller.signal);
      const parsed = parseOlxSearchPage(html);
      if (!parsed) throw new Error('OLX search page has no readable listing data');
      return parsed;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  private async fetchHtml(startUrl: string, signal: AbortSignal): Promise<string> {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl-PL', Accept: 'text/html' },
        signal,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('OLX search redirect without a location');
        const next = new URL(location, url);
        if (next.host !== this.baseHost || (next.protocol !== 'https:' && next.protocol !== 'http:')) {
          throw new Error('OLX search redirected outside the base host');
        }
        url = next.toString();
        continue;
      }
      if (response.status !== 200) throw new Error(`OLX search answered ${response.status}`);
      return await response.text();
    }
    throw new Error('OLX search redirected too many times');
  }
}
