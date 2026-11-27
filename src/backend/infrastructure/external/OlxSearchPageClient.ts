// Loads public OLX search pages: one request at a time for the whole process, a pause after each,
// no cookies, redirects only within the base host. Rejects on any failure; the caller decides.

import type { IOlxAdvertPage, IOlxSearch, OlxSearchPage } from '../../application/ports/IOlxSearch';
import { parseOlxAdvertDelivery } from './olxAdvertPage';
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

export interface OlxRequestGate {
  run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One request at a time, with a pause after each request that was made. A caller that aborts while
// queued is rejected at once and leaves no delay behind; a failed request never blocks the gate.
export function createOlxRequestGate(
  sleep: (ms: number) => Promise<void> = defaultSleep,
  delayMs: number = PAGE_DELAY_MS
): OlxRequestGate {
  let busy = false;
  const queue: Array<() => void> = [];

  const release = async () => {
    try {
      await sleep(delayMs);
    } catch {
      // A failed pause must not wedge the queue.
    }
    const next = queue.shift();
    if (next) next();
    else busy = false;
  };

  return {
    run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('OLX search aborted'));
          return;
        }
        const start = () => {
          signal.removeEventListener('abort', onAbort);
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => void release());
        };
        const onAbort = () => {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error('OLX search aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (busy) {
          queue.push(start);
        } else {
          busy = true;
          start();
        }
      });
    },
  };
}

// The limit holds for the whole process however many clients exist.
const defaultGate = createOlxRequestGate();

interface Deps {
  baseUrl: string;
  fetch?: typeof fetch;
  gate?: OlxRequestGate;
  timeoutMs?: number;
}

export class OlxSearchPageClient implements IOlxSearch, IOlxAdvertPage {
  private readonly fetchImpl: typeof fetch;
  private readonly gate: OlxRequestGate;
  private readonly timeoutMs: number;
  private readonly baseHost: string;
  private readonly baseProtocol: string;

  constructor(private readonly deps: Deps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.gate = deps.gate ?? defaultGate;
    this.timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.baseHost = new URL(deps.baseUrl).host;
    this.baseProtocol = new URL(deps.baseUrl).protocol;
  }

  page(query: string, page: number, signal: AbortSignal): Promise<OlxSearchPage> {
    const url = olxSearchUrl(this.deps.baseUrl, query, page);
    return this.gate.run(signal, () => this.load(url, signal));
  }

  // The public advert page is fetched as given (host www.olx.pl only). When the base URL is not the
  // default, the path and query are rebased onto it, so the stand's mock serves the page.
  deliveryMode(advertUrl: string, signal: AbortSignal): Promise<string | null> {
    let target: URL;
    try {
      const advert = new URL(advertUrl);
      if (this.deps.baseUrl.replace(/\/+$/, '') === DEFAULT_BASE_URL) {
        if (advert.protocol !== 'https:' || advert.host !== new URL(DEFAULT_BASE_URL).host) return Promise.resolve(null);
        target = advert;
      } else {
        target = new URL(`${advert.pathname}${advert.search}`, `${this.deps.baseUrl.replace(/\/+$/, '')}/`);
      }
    } catch {
      return Promise.resolve(null);
    }
    return this.gate
      .run(signal, () => this.loadDelivery(target.toString(), signal))
      .catch(() => null);
  }

  private async loadDelivery(url: string, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) throw new Error('OLX search aborted');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      return parseOlxAdvertDelivery(await this.fetchHtml(url, controller.signal));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
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
        if (next.host !== this.baseHost || next.protocol !== this.baseProtocol) {
          throw new Error('OLX search redirected outside the base host');
        }
        await response.body?.cancel();
        url = next.toString();
        continue;
      }
      if (response.status !== 200) throw new Error(`OLX search answered ${response.status}`);
      return await response.text();
    }
    throw new Error('OLX search redirected too many times');
  }
}
