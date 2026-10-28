// RTK Query base API. Per-entity endpoints are injected in Group 8 via
// `baseApi.injectEndpoints(...)`. This module only sets up the shared query,
// auth header, session-expiry handling, and cache tag types.
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { API_BASE_URL } from '@shared/constants';
import { logout } from '../slices/authSlice.js';
import { enqueueToast } from '../slices/uiSlice.js';

// Minimal shape of the slice this query reads. Typed locally to avoid a
// circular import with store.ts (which imports baseApi).
interface AuthAware {
  auth: { token: string | null };
}

const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

const sessionToken = (state: unknown): string | null => (state as AuthAware).auth?.token ?? null;

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    const token = sessionToken(getState());
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

// A 401 on a request that carried the current session's token means the server no longer accepts
// that session, so end it and say why. Only the first such 401 counts: it clears the token, which
// the other requests in flight no longer match, and neither does a late answer for a session that
// a new sign-in replaced. Wrong credentials also answer 401 on login, which says nothing about
// the session.
export const baseQueryWithAuth: typeof rawBaseQuery = async (args, api, extraOptions) => {
  const sentToken = sessionToken(api.getState());
  const result = await rawBaseQuery(args, api, extraOptions);
  if (
    result.error?.status === 401 &&
    api.endpoint !== 'login' &&
    sentToken !== null &&
    sessionToken(api.getState()) === sentToken
  ) {
    api.dispatch(logout());
    api.dispatch(enqueueToast({ message: SESSION_EXPIRED_MESSAGE, severity: 'warning' }));
  }
  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuth,
  tagTypes: ['Product', 'Listing', 'Marketplace', 'HermesEvent', 'Analytics', 'Settings'],
  endpoints: () => ({}),
});

export default baseApi;
