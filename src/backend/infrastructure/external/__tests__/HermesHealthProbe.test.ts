// HermesHealthProbe decides whether Hermes is configured (local check, no network)
// and whether its API answers (GET /models with a 3 s timeout, cached for 60 s) with no
// toolset enabled (GET /toolsets, same timeout and cache).

import { HermesHealthProbe } from '../HermesHealthProbe';

const originalFetch = globalThis.fetch;

function modelsResponse(): Response {
  return new Response(
    JSON.stringify({ object: 'list', data: [{ id: 'hermes-agent', object: 'model' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function toolsetsResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NO_TOOLSETS = { data: [{ name: 'terminal', enabled: false }] };

// Answers /models with a healthy list and /toolsets with the given reply.
function routedFetch(toolsets: () => Promise<Response> = async () => toolsetsResponse(NO_TOOLSETS)) {
  return jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async (url) =>
    String(url).endsWith('/toolsets') ? toolsets() : modelsResponse(),
  );
}

describe('HermesHealthProbe', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    { apiUrl: 'http://127.0.0.1:8642/v1', apiKey: 'local-hermes-key', configured: true },
    { apiUrl: 'http://127.0.0.1:8642/v1', apiKey: '', configured: false },
    { apiUrl: 'http://127.0.0.1:8642/v1', apiKey: '   ', configured: false },
    { apiUrl: 'http://127.0.0.1:8642/v1', apiKey: 'your_local_hermes_api_server_key', configured: false },
    { apiUrl: '', apiKey: 'local-hermes-key', configured: false },
  ])('treats url "$apiUrl" with key "$apiKey" as configured=$configured', ({ apiUrl, apiKey, configured }) => {
    expect(new HermesHealthProbe({ apiUrl, apiKey }).isConfigured()).toBe(configured);
  });

  it('reports Hermes reachable when GET /models answers 2xx, giving up after 3 seconds', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const fetchMock = routedFetch();
    globalThis.fetch = fetchMock as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://host.docker.internal:8642/v1/',
      apiKey: 'local-hermes-key',
    });

    await expect(probe.isReachable()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://host.docker.internal:8642/v1/models',
      'http://host.docker.internal:8642/v1/toolsets',
    ]);
    fetchMock.mock.calls.forEach(([, init], index) => {
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer local-hermes-key' });
      expect(init?.signal).toBe(timeoutSpy.mock.results[index]?.value);
    });
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 3000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 3000);
  });

  it.each([
    {
      failure: 'a 401 answer',
      reply: async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 }),
    },
    { failure: 'a 503 answer', reply: async () => new Response('', { status: 503 }) },
    {
      failure: 'a refused connection',
      reply: async (): Promise<Response> => {
        throw new TypeError('fetch failed');
      },
    },
    {
      failure: 'a timeout',
      reply: async (): Promise<Response> => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    },
  ])('reports Hermes unreachable on $failure', async ({ reply }) => {
    globalThis.fetch = jest.fn(reply) as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    await expect(probe.isReachable()).resolves.toBe(false);
  });

  it('reuses a reachable answer for 60 seconds, then asks Hermes again', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const fetchMock = routedFetch();
    globalThis.fetch = fetchMock as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    await probe.isReachable();
    nowSpy.mockReturnValue(1_059_999);
    await probe.isReachable();
    const callsWithinWindow = fetchMock.mock.calls.length;
    nowSpy.mockReturnValue(1_060_000);
    await probe.isReachable();

    expect(callsWithinWindow).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reuses an unreachable answer too, so auto mode does not wait on every call', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () => {
      throw new TypeError('fetch failed');
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    const first = await probe.isReachable();
    const second = await probe.isReachable();

    expect([first, second]).toEqual([false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight check between callers that arrive while it runs', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>((url) =>
      String(url).endsWith('/toolsets')
        ? Promise.resolve(toolsetsResponse(NO_TOOLSETS))
        : new Promise<Response>((resolve) => (answer = resolve)),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    const first = probe.isReachable();
    const second = probe.isReachable();
    answer(modelsResponse());

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports Hermes reachable even when releasing the answer body fails', async () => {
    const response = modelsResponse();
    jest.spyOn(response.body!, 'cancel').mockRejectedValue(new TypeError('body already released'));
    globalThis.fetch = jest.fn(async () => response) as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    await expect(probe.isReachable()).resolves.toBe(true);
  });

  it('reports when it checked, and keeps that time while it reuses the answer', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-24T08:00:00.000Z'));
    globalThis.fetch = routedFetch() as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'local-hermes-key',
    });

    const checked = await probe.reachability();
    nowSpy.mockReturnValue(Date.parse('2026-10-24T08:00:30.000Z'));
    const reused = await probe.reachability();

    expect(checked).toEqual({
      reachable: true,
      toolsSafe: true,
      enabledToolsets: [],
      checkedAt: new Date('2026-10-24T08:00:00.000Z'),
    });
    expect(reused).toEqual(checked);
  });

  describe('toolset check', () => {
    const newProbe = () =>
      new HermesHealthProbe({ apiUrl: 'http://127.0.0.1:8642/v1', apiKey: 'local-hermes-key' });

    it('reports tools-safe when every toolset is disabled', async () => {
      globalThis.fetch = routedFetch(async () =>
        toolsetsResponse({
          data: [
            { name: 'terminal', enabled: false },
            { name: 'web', enabled: false },
          ],
        }),
      ) as typeof fetch;

      await expect(newProbe().reachability()).resolves.toMatchObject({
        reachable: true,
        toolsSafe: true,
        enabledToolsets: [],
      });
    });

    it('accepts a top-level array as the toolset list', async () => {
      globalThis.fetch = routedFetch(async () =>
        toolsetsResponse([{ name: 'file', enabled: false }]),
      ) as typeof fetch;

      await expect(newProbe().reachability()).resolves.toMatchObject({ toolsSafe: true });
    });

    it('names the enabled toolsets and reports tools-unsafe', async () => {
      globalThis.fetch = routedFetch(async () =>
        toolsetsResponse({
          data: [
            { name: 'terminal', enabled: true },
            { name: 'web', enabled: false },
            { name: 'memory', enabled: true },
          ],
        }),
      ) as typeof fetch;

      await expect(newProbe().reachability()).resolves.toMatchObject({
        reachable: true,
        toolsSafe: false,
        enabledToolsets: ['terminal', 'memory'],
      });
    });

    it.each([
      { failure: 'a 404 answer', reply: async () => toolsetsResponse('', 404) },
      { failure: 'a 401 answer', reply: async () => toolsetsResponse({ error: 'invalid key' }, 401) },
      {
        failure: 'a refused connection',
        reply: async (): Promise<Response> => {
          throw new TypeError('fetch failed');
        },
      },
      {
        failure: 'a timeout',
        reply: async (): Promise<Response> => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        },
      },
      { failure: 'a non-JSON body', reply: async () => toolsetsResponse('<html>') },
      { failure: 'an object without a list', reply: async () => toolsetsResponse({ ok: true }) },
    ])('reports tools-unsafe on $failure', async ({ reply }) => {
      globalThis.fetch = routedFetch(reply) as typeof fetch;

      await expect(newProbe().reachability()).resolves.toMatchObject({
        reachable: true,
        toolsSafe: false,
        enabledToolsets: [],
      });
    });

    it('does not ask /toolsets when /models fails', async () => {
      const fetchMock = jest.fn(async () => new Response('', { status: 503 }));
      globalThis.fetch = fetchMock as typeof fetch;

      await expect(newProbe().reachability()).resolves.toMatchObject({
        reachable: false,
        toolsSafe: false,
        enabledToolsets: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches the toolset answer with the reachability answer', async () => {
      const fetchMock = routedFetch();
      globalThis.fetch = fetchMock as typeof fetch;
      const probe = newProbe();

      await probe.reachability();
      await probe.reachability();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
