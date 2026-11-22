// Products endpoints, injected into the shared baseApi (Group 8).
import type {
  Product,
  Listing,
  PaginatedResponse,
  ApiResponse,
  ProductAIDraft,
  ProductAIDraftRequest,
  ProductRecheckResult,
  PriceResearch,
  PriceResearchView,
  ResearchRun,
  PriceSync,
  ProductStats,
} from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap, unwrapPaginated } from './envelope.js';
import type { PaginatedApiResponse } from './envelope.js';
import type { PriceResearchBody } from '../../components/product-detail/priceResearchModel.js';
import type {
  ProductListParams,
  CreateProductInput,
  UpdateProductArg,
  CreateProductListingInput,
} from './dto.js';

export interface ProductImageUpload {
  id: string;
  url: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
}

export function buildProductImageUploadRequest(file: File) {
  return {
    url: '/uploads/images',
    method: 'POST' as const,
    body: file,
    headers: { 'content-type': file.type },
  };
}

export function buildProductImageDeleteRequest(imageId: string) {
  return { url: `/uploads/images/${imageId}`, method: 'DELETE' as const };
}

export function buildProductRecheckRequest(input: { productId: string; listingId: string }) {
  return {
    url: `/products/${input.productId}/recheck`,
    method: 'POST' as const,
    body: { listingId: input.listingId },
  };
}

export function buildProductsListUrl(params?: ProductListParams): string {
  const { tags, ...rest } = params ?? {};
  return `/products${buildQueryString({
    ...rest,
    tags: tags?.length ? JSON.stringify(tags) : undefined,
  })}`;
}

// The needs-action list depends on listings (sync) and waiting buyers (sent replies) too.
export function productListTags(
  result: PaginatedResponse<Product> | undefined,
  arg: ProductListParams | undefined
): Array<{ type: 'Product' | 'Listing'; id: string } | { type: 'Awaiting' }> {
  const tags: Array<{ type: 'Product' | 'Listing'; id: string } | { type: 'Awaiting' }> = [
    ...(result?.items ?? []).map((p) => ({ type: 'Product' as const, id: p.id })),
    { type: 'Product', id: 'LIST' },
  ];
  if (arg?.needsAction) tags.push({ type: 'Listing', id: 'LIST' }, { type: 'Awaiting' });
  return tags;
}

export const productsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Views, growth, trend and needs-action reasons per product. Sync refreshes listings,
    // approving a suggestion refreshes products, so both tags refresh the stats.
    getProductStats: builder.query<Record<string, ProductStats>, void>({
      query: () => '/products/stats',
      transformResponse: (res: ApiResponse<{ byProductId: Record<string, ProductStats> }>) =>
        unwrap(res).byProductId,
      providesTags: [
        { type: 'Product', id: 'LIST' },
        { type: 'Listing', id: 'LIST' },
        { type: 'Awaiting' },
      ],
    }),

    getProducts: builder.query<PaginatedResponse<Product>, ProductListParams | void>({
      query: (params) => buildProductsListUrl(params ?? undefined),
      transformResponse: (res: PaginatedApiResponse<Product>) => unwrapPaginated(res),
      providesTags: (result, _error, arg) => productListTags(result, arg ?? undefined),
    }),

    getProduct: builder.query<Product, string>({
      query: (id) => `/products/${id}`,
      transformResponse: (res: ApiResponse<Product>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Product', id }],
    }),

    recheckProduct: builder.mutation<
      ProductRecheckResult,
      { productId: string; listingId: string }
    >({
      query: buildProductRecheckRequest,
      transformResponse: (res: ApiResponse<ProductRecheckResult>) => unwrap(res),
    }),

    getPriceResearch: builder.query<PriceResearchView | null, string>({
      query: (id) => `/products/${id}/price-research`,
      transformResponse: (res: ApiResponse<PriceResearchView | null>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'PriceResearch', id }],
    }),

    savePriceResearch: builder.mutation<
      PriceResearch,
      { productId: string; body: PriceResearchBody }
    >({
      query: ({ productId, body }) => ({
        url: `/products/${productId}/price-research`,
        method: 'PUT',
        body,
      }),
      transformResponse: (res: ApiResponse<PriceResearch>) => unwrap(res),
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'PriceResearch', id: productId },
      ],
    }),

    refreshPriceResearch: builder.mutation<{ run: ResearchRun }, string>({
      query: (productId) => ({ url: `/products/${productId}/price-research/refresh`, method: 'POST' }),
      transformResponse: (res: ApiResponse<{ run: ResearchRun }>) => unwrap(res),
      invalidatesTags: (_result, _error, productId) => [{ type: 'PriceResearch', id: productId }],
    }),

    createProduct: builder.mutation<Product, CreateProductInput>({
      query: (body) => ({ url: '/products', method: 'POST', body }),
      transformResponse: (res: ApiResponse<Product>) => unwrap(res),
      invalidatesTags: [{ type: 'Product', id: 'LIST' }],
    }),

    generateProductAIDraft: builder.mutation<ProductAIDraft, ProductAIDraftRequest>({
      query: (body) => ({ url: '/products/ai-draft', method: 'POST', body }),
      transformResponse: (res: ApiResponse<ProductAIDraft>) => unwrap(res),
      invalidatesTags: ['AiUsage'],
    }),

    uploadProductImage: builder.mutation<ProductImageUpload, File>({
      query: buildProductImageUploadRequest,
      transformResponse: (res: ApiResponse<ProductImageUpload>) => unwrap(res),
    }),

    deleteProductImage: builder.mutation<{ deleted: boolean }, string>({
      query: buildProductImageDeleteRequest,
      transformResponse: (res: ApiResponse<{ deleted: boolean }>) => unwrap(res),
    }),

    updateProduct: builder.mutation<Product & { priceSync?: PriceSync }, UpdateProductArg>({
      query: ({ id, patch }) => ({ url: `/products/${id}`, method: 'PATCH', body: patch }),
      transformResponse: (res: ApiResponse<Product & { priceSync?: PriceSync }>) => unwrap(res),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Product', id },
        { type: 'Product', id: 'LIST' },
      ],
    }),

    deleteProduct: builder.mutation<{ id: string }, string>({
      query: (id) => ({ url: `/products/${id}`, method: 'DELETE' }),
      transformResponse: (_res: ApiResponse<unknown>, _meta, id) => ({ id }),
      // RTK Query also invalidates after a rejected mutation; a refused delete (such as the
      // live-listing guard's 409) changed nothing, so it refetches nothing. Analytics queries are
      // tagged per endpoint (no LIST id), so the bare type refetches them all.
      invalidatesTags: (_result, error, id) =>
        error
          ? []
          : [
              { type: 'Product', id },
              { type: 'Product', id: 'LIST' },
              { type: 'Listing', id: 'LIST' },
              'Analytics',
              { type: 'HermesEvent', id: 'LIST' },
            ],
    }),

    createProductListing: builder.mutation<Listing, CreateProductListingInput>({
      query: ({ productId, ...body }) => ({
        url: `/products/${productId}/listings`,
        method: 'POST',
        body,
      }),
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      invalidatesTags: (result, _error, { productId }) => [
        { type: 'Product', id: productId },
        { type: 'Listing', id: `PRODUCT:${productId}` },
        ...(result ? [{ type: 'Listing' as const, id: result.id }] : []),
      ],
    }),

    getProductListings: builder.query<Listing[], string>({
      query: (id) => `/products/${id}/listings`,
      transformResponse: (res: ApiResponse<Listing[]>) => unwrap(res),
      providesTags: (result, _error, id) =>
        result
          ? [
              ...result.map((l) => ({ type: 'Listing' as const, id: l.id })),
              { type: 'Listing' as const, id: `PRODUCT:${id}` },
            ]
          : [{ type: 'Listing' as const, id: `PRODUCT:${id}` }],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetProductQuery,
  useLazyGetProductQuery,
  useRecheckProductMutation,
  useCreateProductMutation,
  useGenerateProductAIDraftMutation,
  useUploadProductImageMutation,
  useDeleteProductImageMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useCreateProductListingMutation,
  useGetProductListingsQuery,
  useGetProductStatsQuery,
  useGetPriceResearchQuery,
  useSavePriceResearchMutation,
  useRefreshPriceResearchMutation,
} = productsApi;
