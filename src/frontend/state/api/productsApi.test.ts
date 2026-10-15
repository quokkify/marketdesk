import {
  buildProductImageDeleteRequest,
  buildProductImageUploadRequest,
  buildProductRecheckRequest,
  buildProductsListUrl,
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

describe('product recheck API request', () => {
  it('uses a dedicated non-publishing action for the current product', () => {
    expect(buildProductRecheckRequest({ productId: 'product-1', listingId: 'listing-1' })).toEqual({
      url: '/products/product-1/recheck',
      method: 'POST',
      body: { listingId: 'listing-1' },
    });
  });
});

describe('saved improvement review cache', () => {
  it('refreshes a subscribed listing and its price history after a decision', async () => {
    const originalFetch = global.fetch;
    const originalRequest = global.Request;
    global.Request = class extends originalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input,
          init
        );
      }
    };
    const fetched: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      fetched.push(path);
      const data = path.endsWith('decisions')
        ? { sessionId: 's1', productId: 'p1', listingId: 'l1', revision: 2, proposals: [] }
        : path.endsWith('price-history')
          ? []
          : { id: 'l1' };
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { configureStore } = await import('@reduxjs/toolkit');
    const { baseApi } = await import('./baseApi');
    const { productsApi } = await import('./productsApi');
    const { listingsApi } = await import('./listingsApi');
    const store = configureStore({
      reducer: { api: baseApi.reducer, auth: () => ({ token: null }) },
      middleware: (getDefault) => getDefault().concat(baseApi.middleware),
    });
    try {
      await store.dispatch(listingsApi.endpoints.getListing.initiate('l1')).unwrap();
      await store.dispatch(listingsApi.endpoints.getPriceHistory.initiate('l1')).unwrap();
      await store
        .dispatch(
          productsApi.endpoints.decideProductImprovement.initiate({
            productId: 'p1',
            listingId: 'l1',
            sessionId: 's1',
            revision: 1,
            proposalId: 'price',
            action: 'accept',
            editedValue: 90,
          })
        )
        .unwrap();
      await Promise.all(store.dispatch(baseApi.util.getRunningQueriesThunk()));
      expect(fetched.filter((path) => path === '/api/listings/l1')).toHaveLength(2);
      expect(fetched.filter((path) => path === '/api/listings/l1/price-history')).toHaveLength(2);
    } finally {
      store.dispatch(baseApi.util.resetApiState());
      global.fetch = originalFetch;
      global.Request = originalRequest;
    }
  });
});
