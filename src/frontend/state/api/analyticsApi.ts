// Analytics endpoints, injected into the shared baseApi (Group 8).
import type { ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap } from './envelope.js';
import type {
  AnalyticsQueryParams,
  AnalyticsOverview,
} from './dto.js';

export const analyticsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAnalyticsOverview: builder.query<AnalyticsOverview, AnalyticsQueryParams | void>({
      query: (params) => `/analytics/overview${buildQueryString({ ...(params ?? {}) })}`,
      transformResponse: (res: ApiResponse<AnalyticsOverview>) => unwrap(res),
      providesTags: [{ type: 'Analytics', id: 'OVERVIEW' }],
    }),
  }),
});

export const { useGetAnalyticsOverviewQuery } = analyticsApi;
