import { configureStore } from '@reduxjs/toolkit';
import { analyticsApi } from './analyticsApi';
import { baseApi } from './baseApi';
import { hermesApi } from './hermesApi';
import { listingsApi } from './listingsApi';
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
  const emptyPage = { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  let deleteResponse: { status: number; body: unknown };

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
      const { status, body } = request.method === 'DELETE'
        ? deleteResponse
        : {
            status: 200,
            body: pathname === '/api/hermes/events' || pathname === '/api/products'
              ? emptyPage
              : { success: true, data: pathname === '/api/listings' ? [] : {} },
          };
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.Request = NativeRequest;
    globalThis.fetch = nativeFetch;
  });

  beforeEach(() => {
    deleteResponse = { status: 200, body: { success: true, data: { deleted: true } } };
  });

  // Polls without failing so a missing or unexpected refetch shows up in the assertion's diff.
  async function settle(condition: () => boolean, timeoutMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const newStore = () =>
    configureStore({
      reducer: { [baseApi.reducerPath]: baseApi.reducer },
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
    });

  // One subscriber per tag the delete can invalidate, as on the Products, Dashboard,
  // Analytics and Hermes screens.
  const viewsOfTheProduct = [
    'GET /api/products',
    'GET /api/products/product-1',
    'GET /api/listings',
    'GET /api/analytics/overview',
    'GET /api/analytics/listings',
    'GET /api/hermes/events',
  ];

  async function whileTheProductIsOnScreen(
    run: (store: ReturnType<typeof newStore>) => Promise<void>,
  ): Promise<void> {
    const store = newStore();
    const subscriptions = [
      store.dispatch(productsApi.endpoints.getProducts.initiate()),
      store.dispatch(productsApi.endpoints.getProduct.initiate('product-1')),
      store.dispatch(listingsApi.endpoints.getListings.initiate()),
      store.dispatch(analyticsApi.endpoints.getAnalyticsOverview.initiate()),
      store.dispatch(analyticsApi.endpoints.getAnalyticsListings.initiate()),
      store.dispatch(hermesApi.endpoints.getHermesEvents.initiate()),
    ];
    try {
      await Promise.all(subscriptions);
      requested.length = 0;
      await run(store);
    } finally {
      // Dropping the cache clears RTK Query's keep-unused-data timers so Jest can exit.
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      store.dispatch(baseApi.util.resetApiState());
    }
  }

  it('refetches every view that counted a deleted product, Dashboard KPIs and Hermes events included', async () => {
    await whileTheProductIsOnScreen(async (store) => {
      await store.dispatch(productsApi.endpoints.deleteProduct.initiate('product-1'));
      await settle(() => viewsOfTheProduct.every((request) => requested.includes(request)));

      expect(requested).toEqual(
        expect.arrayContaining(['DELETE /api/products/product-1', ...viewsOfTheProduct]),
      );
    });
  });

  it('refetches nothing when the server refuses the delete', async () => {
    deleteResponse = {
      status: 409,
      body: { success: false, error: { code: 'CONFLICT', message: 'Delist the live listing first.' } },
    };

    await whileTheProductIsOnScreen(async (store) => {
      const result = await store.dispatch(productsApi.endpoints.deleteProduct.initiate('product-1'));
      await settle(() => requested.length > 1, 200);

      expect('error' in result ? result.error : undefined).toMatchObject({ status: 409 });
      expect(requested).toEqual(['DELETE /api/products/product-1']);
    });
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
