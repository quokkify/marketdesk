// RTK Query base API. Per-entity endpoints are injected in Group 8 via
// `baseApi.injectEndpoints(...)`. This module only sets up the shared query,
// auth header, session-expiry handling, and cache tag types.
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { API_BASE_URL } from '@shared/constants';
import { logout, setToken } from '../slices/authSlice.js';
import { enqueueToast } from '../slices/uiSlice.js';
import { WRONG_CURRENT_PASSWORD_MESSAGE, apiErrorMessage } from './envelope.js';

// Minimal shape of the slice this query reads. Typed locally to avoid a
// circular import with store.ts (which imports baseApi).
interface AuthAware {
  auth: { token: string | null };
}

const RENEWED_TOKEN_HEADER = 'x-renewed-token';
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
// the session. A password change answers 401 for a wrong current password, which is not a verdict
// on the session either (any other 401 from it is), and signing out ends the session itself, whatever the answer.
//
// A successful answer may carry a renewed token. It replaces the session token only while the
// session that sent the request is still the current one.
export const baseQueryWithAuth: typeof rawBaseQuery = async (args, api, extraOptions) => {
  const sentToken = sessionToken(api.getState());
  const result = await rawBaseQuery(args, api, extraOptions);
  const sameSession = sentToken !== null && sessionToken(api.getState()) === sentToken;
  if (
    result.error?.status === 401 &&
    api.endpoint !== 'login' &&
    !(
      api.endpoint === 'changePassword' &&
      apiErrorMessage(result.error) === WRONG_CURRENT_PASSWORD_MESSAGE
    ) &&
    api.endpoint !== 'logout' &&
    sameSession
  ) {
    api.dispatch(logout());
    api.dispatch(enqueueToast({ message: SESSION_EXPIRED_MESSAGE, severity: 'warning' }));
  }
  const renewed = result.meta?.response?.headers.get(RENEWED_TOKEN_HEADER);
  if (renewed && !result.error && sameSession) api.dispatch(setToken(renewed));
  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuth,
  tagTypes: ['Product', 'Listing', 'Conversation', 'Awaiting', 'Marketplace', 'HermesEvent', 'Analytics', 'Settings', 'AiUsage', 'PriceResearch'],
  endpoints: () => ({}),
});

export default baseApi;
