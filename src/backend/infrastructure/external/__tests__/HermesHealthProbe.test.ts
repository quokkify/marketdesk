// HermesHealthProbe decides whether Hermes is configured (local check, no network)
// and whether its API answers (GET /models with a 3 s timeout, cached for 60 s).

import { HermesHealthProbe } from '../HermesHealthProbe';

const originalFetch = globalThis.fetch;

function modelsResponse(): Response {
  return new Response(
    JSON.stringify({ object: 'list', data: [{ id: 'hermes-agent', object: 'model' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
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
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      modelsResponse(),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const probe = new HermesHealthProbe({
      apiUrl: 'http://host.docker.internal:8642/v1/',
      apiKey: 'local-hermes-key',
    });

    await expect(probe.isReachable()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:8642/v1/models');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer local-hermes-key' });
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    expect(init?.signal).toBe(timeoutSpy.mock.results[0]?.value);
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
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      modelsResponse(),
    );
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

    expect(callsWithinWindow).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
});
