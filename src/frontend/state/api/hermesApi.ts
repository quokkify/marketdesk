// Hermes (autonomous agent) endpoints, injected into the shared baseApi (Group 8).
import type { HermesEvent, HermesStatusView, PaginatedResponse, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap, unwrapPaginated } from './envelope.js';
import type { PaginatedApiResponse } from './envelope.js';
import type {
  CategoryRecreationOperationCommand,
  CategoryRecreationOperationResolution,
  HermesEventFeedParams,
  HermesEventListParams,
  HermesRunInput,
} from './dto.js';

// Events fetched per "Load more" step of the activity feed.
export const HERMES_FEED_PAGE_SIZE = 20;

export function buildHermesEventsUrl(params: HermesEventListParams = {}): string {
  return `/hermes/events${buildQueryString({ ...params })}`;
}

// The feed cursor is the offset of a page's first event. Another page exists only
// while the server's pagination.total counts more events than were loaded; an empty
// page ends the feed even when the total is stale.
export function hermesFeedNextOffset(
  lastPage: PaginatedResponse<HermesEvent>,
  lastOffset: number,
): number | undefined {
  const next = lastOffset + lastPage.items.length;
  return lastPage.items.length > 0 && next < lastPage.total ? next : undefined;
}

export function buildProductHermesRunRequest(input: HermesRunInput) {
  const { productId, trigger = 'manual' } = input;
  return {
    url: `/hermes/products/${encodeURIComponent(productId)}/run`,
    method: 'POST' as const,
    body: { trigger },
  };
}

export const hermesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getHermesEvents: builder.query<PaginatedResponse<HermesEvent>, HermesEventListParams | void>({
      query: (params) => buildHermesEventsUrl(params ?? {}),
      transformResponse: (res: PaginatedApiResponse<HermesEvent>) => unwrapPaginated(res),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((e) => ({ type: 'HermesEvent' as const, id: e.id })),
              { type: 'HermesEvent' as const, id: 'LIST' },
            ]
          : [{ type: 'HermesEvent' as const, id: 'LIST' }],
    }),

    // The activity feed: one cached entry per filter set, grown page by page. Tag
    // invalidation after approve/dismiss refetches every loaded page.
    getHermesEventsFeed: builder.infiniteQuery<
      PaginatedResponse<HermesEvent>,
      HermesEventFeedParams,
      number
    >({
      infiniteQueryOptions: {
        initialPageParam: 0,
        getNextPageParam: (lastPage, _allPages, lastPageParam) =>
          hermesFeedNextOffset(lastPage, lastPageParam),
      },
      query: ({ queryArg, pageParam }) =>
        buildHermesEventsUrl({ ...queryArg, limit: HERMES_FEED_PAGE_SIZE, offset: pageParam }),
      transformResponse: (res: PaginatedApiResponse<HermesEvent>) => unwrapPaginated(res),
      providesTags: (result) => [
        ...(result?.pages ?? []).flatMap((page) =>
          page.items.map((e) => ({ type: 'HermesEvent' as const, id: e.id })),
        ),
        { type: 'HermesEvent' as const, id: 'LIST' },
      ],
    }),

    // Which AI provider answers: Hermes, or the built-in offline heuristics.
    getHermesStatus: builder.query<HermesStatusView, void>({
      query: () => '/hermes/status',
      transformResponse: (res: ApiResponse<HermesStatusView>) => unwrap(res),
    }),

    getHermesEvent: builder.query<HermesEvent, string>({
      query: (id) => `/hermes/events/${id}`,
      transformResponse: (res: ApiResponse<HermesEvent>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'HermesEvent', id }],
    }),

    // Approving applies the proposed change, so it also touches products/listings.
    approveHermesEvent: builder.mutation<HermesEvent, string>({
      query: (id) => ({ url: `/hermes/events/${id}/approve`, method: 'POST' }),
      transformResponse: (res: ApiResponse<HermesEvent>) => unwrap(res),
      invalidatesTags: (_result, _error, id) => [
        { type: 'HermesEvent', id },
        { type: 'HermesEvent', id: 'LIST' },
        { type: 'Product', id: 'LIST' },
        { type: 'Listing', id: 'LIST' },
      ],
    }),

    dismissHermesEvent: builder.mutation<HermesEvent, string>({
      query: (id) => ({ url: `/hermes/events/${id}/dismiss`, method: 'POST' }),
      transformResponse: (res: ApiResponse<HermesEvent>) => unwrap(res),
      invalidatesTags: (_result, _error, id) => [
        { type: 'HermesEvent', id },
        { type: 'HermesEvent', id: 'LIST' },
      ],
    }),

    executeCategoryRecreationOperation: builder.mutation<
      CategoryRecreationOperationResolution,
      CategoryRecreationOperationCommand
    >({
      query: ({ action, paidOverrideReason }) => ({
        url: action.href,
        method: action.method,
        body: action.kind === 'approve' && paidOverrideReason ? { paidOverrideReason } : {},
      }),
      transformResponse: (res: ApiResponse<CategoryRecreationOperationResolution>) => unwrap(res),
      invalidatesTags: (result) => [
        { type: 'HermesEvent', id: result?.recommendationEventId ?? 'LIST' },
        { type: 'HermesEvent', id: 'LIST' },
        { type: 'Listing', id: 'LIST' },
      ],
    }),

    // Product-scoped analysis only. The legacy POST /hermes/run endpoint remains backend-compatible,
    // but frontend callers must choose one explicit product.
    runHermes: builder.mutation<HermesEvent[], HermesRunInput>({
      query: buildProductHermesRunRequest,
      transformResponse: (res: ApiResponse<HermesEvent[]>) => unwrap(res),
      invalidatesTags: [{ type: 'HermesEvent', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetHermesEventsQuery,
  useGetHermesEventsFeedInfiniteQuery,
  useGetHermesStatusQuery,
  useGetHermesEventQuery,
  useApproveHermesEventMutation,
  useDismissHermesEventMutation,
  useExecuteCategoryRecreationOperationMutation,
  useRunHermesMutation,
} = hermesApi;
