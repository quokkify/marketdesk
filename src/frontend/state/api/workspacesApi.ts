// Workspace endpoints, injected into the shared baseApi (Group 8).
import type { Workspace, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

export const workspacesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getWorkspace: builder.query<Workspace, string>({
      query: (id) => `/workspaces/${id}`,
      transformResponse: (res: ApiResponse<Workspace>) => unwrap(res),
    }),
  }),
});

export const { useGetWorkspaceQuery } = workspacesApi;
