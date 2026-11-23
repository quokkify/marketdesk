import { OlxSearchPageClient, PAGE_DELAY_MS, MAX_PAGES, loadOlxSearchBaseUrl } from '../OlxSearchPageClient';
import { olxSearchUrl } from '../olxSearchPage';

const BASE = 'https://www.olx.pl';

function okPage(): string {
  const state = { listing: { listing: { totalElements: 1, totalPages: 1, ads: [{ id: 7 }] } } };
  return `<script>window.__PRERENDERED_STATE__= ${JSON.stringify(JSON.stringify(state))};</script>`;
}

function reply(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function build(fetchImpl: jest.Mock, sleep: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  return { client: new OlxSearchPageClient({ baseUrl: BASE, fetch: fetchImpl, sleep }), sleep };
}

const signal = () => new AbortController().signal;

describe('OlxSearchPageClient', () => {
  it('fetches the search URL without cookies and parses the page', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, okPage()));
    const { client } = build(fetchImpl);
    const page = await client.page('airpods 4', 2, signal());
    expect(page.cards).toEqual([{ id: '7', price: null, promoted: false }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(olxSearchUrl(BASE, 'airpods 4', 2));
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('manual');
    expect(init.headers['Accept-Language']).toBe('pl-PL');
    expect(init.headers['User-Agent']).toMatch(/Mozilla/);
    expect(init.headers.Cookie).toBeUndefined();
  });

  it('rejects on a 403', async () => {
    const { client } = build(jest.fn().mockResolvedValue(reply(403)));
    await expect(client.page('airpods 4', 1, signal())).rejects.toThrow();
  });

  it('rejects on a 200 page without the embedded state', async () => {
    const { client } = build(jest.fn().mockResolvedValue(reply(200, '<html>captcha</html>')));
    await expect(client.page('airpods 4', 1, signal())).rejects.toThrow();
  });

  it('does not overlap requests and waits PAGE_DELAY_MS between them', async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      events.push(`fetch-start-${calls}`);
      if (calls === 1) await gate;
      events.push(`fetch-end-${calls}`);
      return reply(200, okPage());
    });
    const sleep = jest.fn(async (ms: number) => {
      events.push(`sleep-${ms}`);
    });
    const { client } = build(fetchImpl, sleep);
    const first = client.page('airpods 4', 1, signal());
    const second = client.page('airpods 4', 2, signal());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['fetch-start-1']);
    release();
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([
      'fetch-start-1',
      'fetch-end-1',
      `sleep-${PAGE_DELAY_MS}`,
      'fetch-start-2',
      'fetch-end-2',
      `sleep-${PAGE_DELAY_MS}`,
    ]);
  });

  it('keeps the chain alive after a failed request', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(reply(500))
      .mockResolvedValueOnce(reply(200, okPage()));
    const { client } = build(fetchImpl);
    await expect(client.page('airpods 4', 1, signal())).rejects.toThrow();
    await expect(client.page('airpods 4', 1, signal())).resolves.toBeDefined();
  });

  it('rejects an aborted signal without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const { client } = build(fetchImpl);
    const controller = new AbortController();
    controller.abort();
    await expect(client.page('airpods 4', 1, controller.signal)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows a redirect within the host and rejects one to another host', async () => {
    const within = jest
      .fn()
      .mockResolvedValueOnce(reply(301, '', { location: '/oferty/q-airpods-4/' }))
      .mockResolvedValueOnce(reply(200, okPage()));
    await expect(build(within).client.page('airpods 4', 1, signal())).resolves.toBeDefined();
    expect(within.mock.calls[1][0]).toBe(`${BASE}/oferty/q-airpods-4/`);

    const away = jest.fn().mockResolvedValue(reply(302, '', { location: 'https://evil.example/x' }));
    await expect(build(away).client.page('airpods 4', 1, signal())).rejects.toThrow();
    expect(away).toHaveBeenCalledTimes(1);
  });

  it('rejects after more than three redirects', async () => {
    const loop = jest.fn().mockImplementation(async () => reply(302, '', { location: '/oferty/q-airpods-4/' }));
    await expect(build(loop).client.page('airpods 4', 1, signal())).rejects.toThrow();
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it('rejects on a timeout', async () => {
    const hang = jest.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
    );
    const client = new OlxSearchPageClient({
      baseUrl: BASE,
      fetch: hang as unknown as typeof fetch,
      sleep: jest.fn().mockResolvedValue(undefined),
      timeoutMs: 20,
    });
    await expect(client.page('airpods 4', 1, signal())).rejects.toThrow();
  });

  it('exports the page cap', () => {
    expect(MAX_PAGES).toBe(10);
  });
});

describe('loadOlxSearchBaseUrl', () => {
  const saved = process.env.OLX_SEARCH_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.OLX_SEARCH_BASE_URL;
    else process.env.OLX_SEARCH_BASE_URL = saved;
  });

  it('defaults, trims the trailing slash and rejects non-http URLs', () => {
    delete process.env.OLX_SEARCH_BASE_URL;
    expect(loadOlxSearchBaseUrl()).toBe('https://www.olx.pl');
    process.env.OLX_SEARCH_BASE_URL = 'http://localhost:9000/';
    expect(loadOlxSearchBaseUrl()).toBe('http://localhost:9000');
    process.env.OLX_SEARCH_BASE_URL = 'ftp://x';
    expect(() => loadOlxSearchBaseUrl()).toThrow();
    process.env.OLX_SEARCH_BASE_URL = 'not a url';
    expect(() => loadOlxSearchBaseUrl()).toThrow();
  });
});
