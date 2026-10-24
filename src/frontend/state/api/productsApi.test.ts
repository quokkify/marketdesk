import { configureStore } from '@reduxjs/toolkit';
import { analyticsApi } from './analyticsApi';
import { baseApi } from './baseApi';
import { hermesApi } from './hermesApi';
import {
  buildProductImageDeleteRequest,
  buildProductImageUploadRequest,
  buildProductRecheckRequest,
  buildProductsListUrl,
  productsApi,
} from './productsApi';

describe('product image API requests', () => {
  it('uploads the original file as a typed raw request body', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.webp', { type: 'image/webp' });

    expect(buildProductImageUploadRequest(file)).toEqual({
      url: '/uploads/images',
      method: 'POST',
      body: file,
      headers: { 'content-type': 'image/webp' },
    });
  });

  it('targets the workspace-scoped delete endpoint by opaque image id', () => {
    expect(buildProductImageDeleteRequest('123e4567-e89b-42d3-a456-426614174000')).toEqual({
      url: '/uploads/images/123e4567-e89b-42d3-a456-426614174000',
      method: 'DELETE',
    });
  });
});

describe('products list API request', () => {
  it('serializes tags as an unambiguous JSON array so commas round-trip', () => {
    expect(buildProductsListUrl({ tags: ['home, office', 'featured'], limit: 25 })).toBe(
      '/products?limit=25&tags=%5B%22home%2C+office%22%2C%22featured%22%5D'
    );
  });
});

describe('product deletion cache invalidation', () => {
  const NativeRequest = globalThis.Request;
  const nativeFetch = globalThis.fetch;
  const requested: string[] = [];

  beforeAll(() => {
    // fetchBaseQuery builds a Request from the relative `/api` base URL, which Node cannot parse.
    globalThis.Request = class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, 'http://marketdesk.test').toString() : input, init);
      }
    } as typeof Request;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(request.url);
      requested.push(`${request.method} ${pathname}`);
      const body = pathname === '/api/hermes/events'
        ? { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }
        : { success: true, data: {} };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.Request = NativeRequest;
    globalThis.fetch = nativeFetch;
  });

  // Polls without failing so a missing refetch shows up in the assertion's diff.
  async function settle(condition: () => boolean, timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('refetches the Dashboard KPIs, analytics and Hermes events that counted the deleted product', async () => {
    const store = configureStore({
      reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    });
    const subscriptions = [
      store.dispatch(analyticsApi.endpoints.getAnalyticsOverview.initiate()),
      store.dispatch(analyticsApi.endpoints.getAnalyticsListings.initiate()),
      store.dispatch(hermesApi.endpoints.getHermesEvents.initiate()),
    ];
    const expected = [
      'GET /api/analytics/overview',
      'GET /api/analytics/listings',
      'GET /api/hermes/events',
    ];
    try {
      await Promise.all(subscriptions);
      requested.length = 0;

      await store.dispatch(productsApi.endpoints.deleteProduct.initiate('product-1'));
      await settle(() => expected.every((request) => requested.includes(request)));

      expect(requested).toEqual(
        expect.arrayContaining(['DELETE /api/products/product-1', ...expected]),
      );
    } finally {
      // Dropping the cache clears RTK Query's keep-unused-data timers so Jest can exit.
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      store.dispatch(baseApi.util.resetApiState());
    }
  });
});

describe('product recheck API request', () => {
  it('uses a dedicated non-publishing action for the current product', () => {
    expect(buildProductRecheckRequest({ productId: 'product-1', listingId: 'listing-1' })).toEqual({
      url: '/products/product-1/recheck',
      method: 'POST',
      body: { listingId: 'listing-1' },
    });
  });
});
