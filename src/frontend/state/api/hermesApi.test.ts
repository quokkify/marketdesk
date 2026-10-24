import { configureStore } from '@reduxjs/toolkit';
import type { HermesEvent, HermesEventStatus, HermesStatusView, PaginatedResponse } from '@shared/types';
import { baseApi } from './baseApi';
import {
  HERMES_FEED_PAGE_SIZE,
  buildHermesEventsUrl,
  buildProductHermesRunRequest,
  hermesApi,
  hermesFeedNextOffset,
} from './hermesApi';

describe('Hermes frontend API contract', () => {
  it('builds only product-scoped analysis requests for an explicit product', () => {
    expect(buildProductHermesRunRequest({ productId: 'product-1', trigger: 'manual' })).toEqual({
      url: '/hermes/products/product-1/run',
      method: 'POST',
      body: { trigger: 'manual' },
    });
  });

  it('encodes opaque product ids and never falls back to the legacy catalogue route', () => {
    const request = buildProductHermesRunRequest({ productId: 'product/with space' });

    expect(request).toEqual({
      url: '/hermes/products/product%2Fwith%20space/run',
      method: 'POST',
      body: { trigger: 'manual' },
    });
    expect(request.url).not.toBe('/hermes/run');
  });
});

describe('Hermes events list request', () => {
  it('sends multi-value filters as the comma-separated lists the controller parses', () => {
    expect(
      buildHermesEventsUrl({
        status: ['pending_decision', 'pending_review'],
        severity: ['warning', 'critical'],
        limit: 20,
        offset: 40,
      }),
    ).toBe(
      '/hermes/events?status=pending_decision%2Cpending_review&severity=warning%2Ccritical&limit=20&offset=40',
    );
  });

  it('omits empty filters so an unfiltered feed is just the collection URL', () => {
    expect(buildHermesEventsUrl()).toBe('/hermes/events');
    expect(buildHermesEventsUrl({ status: [], severity: [] })).toBe('/hermes/events');
  });
});

describe('Hermes feed paging', () => {
  const page = (itemCount: number, total: number): PaginatedResponse<HermesEvent> => ({
    items: Array.from({ length: itemCount }, (_, index) => ({ id: `event-${index}` }) as HermesEvent),
    total,
    page: 1,
    limit: HERMES_FEED_PAGE_SIZE,
    totalPages: Math.ceil(total / HERMES_FEED_PAGE_SIZE),
  });

  it('continues from the number of events already loaded while pagination.total says more exist', () => {
    expect(hermesFeedNextOffset(page(20, 45), 0)).toBe(20);
    expect(hermesFeedNextOffset(page(20, 45), 20)).toBe(40);
  });

  it('stops once every event the server counted has been loaded', () => {
    expect(hermesFeedNextOffset(page(5, 45), 40)).toBeUndefined();
    expect(hermesFeedNextOffset(page(20, 20), 0)).toBeUndefined();
  });

  it('never loops on an empty page even when total is stale', () => {
    expect(hermesFeedNextOffset(page(0, 45), 40)).toBeUndefined();
  });
});

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Hermes endpoints against the wire format', () => {
  const NativeRequest = globalThis.Request;
  const nativeFetch = globalThis.fetch;
  const requested: URL[] = [];
  let respond: (url: URL) => unknown = () => ({ success: true, data: null });

  beforeAll(() => {
    // fetchBaseQuery builds a Request from the relative `/api` base URL, which Node cannot parse.
    globalThis.Request = class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, 'http://marketdesk.test').toString() : input, init);
      }
    } as typeof Request;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requested.push(url);
      return new Response(JSON.stringify(respond(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.Request = NativeRequest;
    globalThis.fetch = nativeFetch;
  });

  const createStore = () =>
    configureStore({
      reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    });
  const stores: Array<ReturnType<typeof createStore>> = [];
  const newStore = () => {
    const store = createStore();
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    requested.length = 0;
  });

  // Dropping the cache clears RTK Query's keep-unused-data timers so Jest can exit.
  afterEach(() => {
    stores.splice(0).forEach((store) => store.dispatch(baseApi.util.resetApiState()));
  });

  it('reads the provider status from GET /api/hermes/status and unwraps the envelope', async () => {
    const status: HermesStatusView = {
      mode: 'auto',
      activeProvider: 'offline',
      hermesConfigured: false,
      hermesReachable: null,
      checkedAt: '2026-10-24T10:00:00.000Z',
    };
    respond = () => ({ success: true, data: status });

    const result = await newStore().dispatch(hermesApi.endpoints.getHermesStatus.initiate());

    expect(requested.map((url) => url.pathname)).toEqual(['/api/hermes/status']);
    expect(result.data).toEqual(status);
  });

  it('pages the feed by offset, filtered server-side, until pagination.total is reached', async () => {
    const events = ['a', 'b', 'c'].map((id) => ({ id }) as HermesEvent);
    respond = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      return {
        success: true,
        data: events.slice(offset, offset + 2),
        pagination: { page: 1, limit: 20, total: events.length, totalPages: 1 },
      };
    };
    const store = newStore();
    const filters = { status: ['pending_decision', 'pending_review'] as HermesEventStatus[] };

    const feed = store.dispatch(hermesApi.endpoints.getHermesEventsFeed.initiate(filters));
    const first = await feed;

    expect(requested[0].pathname).toBe('/api/hermes/events');
    expect(requested[0].searchParams.get('status')).toBe('pending_decision,pending_review');
    expect(requested[0].searchParams.get('limit')).toBe(String(HERMES_FEED_PAGE_SIZE));
    expect(requested[0].searchParams.get('offset')).toBe('0');
    expect(first.data?.pages.map((p) => p.items.map((e) => e.id))).toEqual([['a', 'b']]);
    expect(first.hasNextPage).toBe(true);

    // What the hook's fetchNextPage does: ask for the next page of the same cache entry.
    const second = await store.dispatch(
      hermesApi.endpoints.getHermesEventsFeed.initiate(filters, {
        direction: 'forward',
        subscribe: false,
      }),
    );

    expect(requested[1].searchParams.get('offset')).toBe('2');
    expect(second.data?.pages.map((p) => p.items.map((e) => e.id))).toEqual([['a', 'b'], ['c']]);
    expect(second.hasNextPage).toBe(false);
  });

  it('refetches every loaded page when an approve or dismiss invalidates Hermes events', async () => {
    const events = ['a', 'b', 'c'].map((id) => ({ id }) as HermesEvent);
    respond = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      return {
        success: true,
        data: events.slice(offset, offset + 2),
        pagination: { page: 1, limit: 20, total: events.length, totalPages: 1 },
      };
    };
    const store = newStore();
    const feed = hermesApi.endpoints.getHermesEventsFeed;
    await store.dispatch(feed.initiate({}));
    await store.dispatch(feed.initiate({}, { direction: 'forward', subscribe: false }));
    requested.length = 0;

    store.dispatch(baseApi.util.invalidateTags([{ type: 'HermesEvent', id: 'LIST' }]));

    await waitUntil(() => requested.length >= 2);
    expect(requested.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2']);
  });
});
