// Session handling in the shared RTK Query base query. A 401 on an authenticated request ends
// the session once, wrong credentials never do, and logout leaves nothing of the previous user
// behind. Requests go through the real store and the real endpoints; only `fetch` is faked.
import type { User } from '@shared/types';
import { createAppStore, type AppStore } from '../store';
import { logout, setCredentials } from '../slices/authSlice';
import { clearToasts } from '../slices/uiSlice';
import { setWorkspace } from '../slices/workspaceSlice';
import { baseApi } from './baseApi';
import { authApi } from './authApi';
import { marketplacesApi } from './marketplacesApi';
import { workspacesApi } from './workspacesApi';

// fetchBaseQuery builds a Request, which needs an absolute URL outside a browser.
jest.mock('@shared/constants', () => ({
  ...jest.requireActual('@shared/constants'),
  API_BASE_URL: 'http://marketdesk.test/api',
}));

const SESSION_EXPIRED = 'Your session expired. Please sign in again.';

const userA: User = {
  id: 'user-a',
  email: 'a@example.test',
  workspaceId: 'ws-1',
  createdAt: '2026-10-24T00:00:00.000Z',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauthorized = () =>
  json(401, {
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
  });
const wrongCredentials = () =>
  json(401, {
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
  });

let fetchMock: jest.SpiedFunction<typeof fetch>;
const stores: AppStore[] = [];

function serve(routes: Record<string, (request: Request) => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const route = routes[new URL(request.url).pathname];
    return route
      ? route(request)
      : json(404, { success: false, error: { code: 'NOT_FOUND', message: 'No route' } });
  });
}

function newStore(): AppStore {
  const store = createAppStore();
  stores.push(store);
  return store;
}

function signIn(store: AppStore, token: string) {
  store.dispatch(setCredentials({ token, user: userA }));
}

// Lets RTK Query start the request, so a response can be held back until the test releases it.
const requestInFlight = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  // Clears the RTK Query cache-removal timers so Jest can exit promptly.
  for (const store of stores.splice(0)) store.dispatch(baseApi.util.resetApiState());
  fetchMock.mockRestore();
});

// Regression guard: an expired token used to leave the user in an app where every request
// failed, with nothing saying why and no way back except clearing storage by hand.
describe('session expiry', () => {
  it('ends the session and shows one warning when an authenticated request is answered with 401', async () => {
    const store = newStore();
    signIn(store, 'expired-token');
    serve({ '/api/auth/me': unauthorized });

    await store.dispatch(authApi.endpoints.me.initiate());

    expect(store.getState().auth).toMatchObject({
      token: null,
      user: null,
      isAuthenticated: false,
    });
    expect(store.getState().ui.toasts).toEqual([
      expect.objectContaining({ message: SESSION_EXPIRED, severity: 'warning' }),
    ]);
  });

  it('shows the warning once when several in-flight requests fail with the same expired token', async () => {
    const store = newStore();
    signIn(store, 'expired-token');
    serve({
      '/api/auth/me': unauthorized,
      '/api/workspaces/ws-1': unauthorized,
      '/api/marketplaces': unauthorized,
    });

    await Promise.all([
      store.dispatch(authApi.endpoints.me.initiate()),
      store.dispatch(workspacesApi.endpoints.getWorkspace.initiate('ws-1')),
      store.dispatch(marketplacesApi.endpoints.getMarketplaces.initiate()),
    ]);

    expect(store.getState().ui.toasts).toHaveLength(1);
    expect(store.getState().auth.token).toBeNull();
  });

  it('warns again when a later session expires', async () => {
    const store = newStore();
    serve({ '/api/auth/me': unauthorized });
    signIn(store, 'first-token');
    await store.dispatch(authApi.endpoints.me.initiate());
    store.dispatch(clearToasts());

    signIn(store, 'second-token');
    await store.dispatch(authApi.endpoints.me.initiate());

    expect(store.getState().auth.token).toBeNull();
    expect(store.getState().ui.toasts).toEqual([
      expect.objectContaining({ message: SESSION_EXPIRED, severity: 'warning' }),
    ]);
  });

  it('ignores a late 401 for a session that a new sign-in already replaced', async () => {
    const store = newStore();
    signIn(store, 'old-token');
    let answer!: (response: Response) => void;
    const heldBack = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    serve({ '/api/auth/me': () => heldBack });
    const pending = store.dispatch(authApi.endpoints.me.initiate());
    await requestInFlight();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    signIn(store, 'new-token');
    answer(unauthorized());
    await pending;

    expect(store.getState().auth.token).toBe('new-token');
    expect(store.getState().ui.toasts).toEqual([]);
  });

  it('does not warn about an expired session for a request that was sent without one', async () => {
    const store = newStore();
    serve({ '/api/auth/me': unauthorized });

    const result = await store.dispatch(authApi.endpoints.me.initiate());

    expect(result).toMatchObject({ error: { status: 401 } });
    expect(store.getState().ui.toasts).toEqual([]);
  });

  it('does not treat wrong credentials as an expired session', async () => {
    const store = newStore();
    serve({ '/api/auth/login': wrongCredentials });

    const result = await store.dispatch(
      authApi.endpoints.login.initiate({ email: userA.email, password: 'wrong-password' })
    );

    expect(result).toMatchObject({
      error: { status: 401, data: { error: { message: 'Invalid email or password' } } },
    });
    expect(store.getState().ui.toasts).toEqual([]);
  });

  it('keeps a signed-in session when a login attempt with wrong credentials fails', async () => {
    const store = newStore();
    signIn(store, 'valid-token');
    serve({ '/api/auth/login': wrongCredentials });

    await store.dispatch(
      authApi.endpoints.login.initiate({ email: userA.email, password: 'wrong-password' })
    );

    expect(store.getState().auth.token).toBe('valid-token');
    expect(store.getState().ui.toasts).toEqual([]);
  });

  it.each([403, 429, 500, 503])(
    'keeps the session when a request fails with %i',
    async (status) => {
      const store = newStore();
      signIn(store, 'valid-token');
      serve({ '/api/auth/me': () => json(status, { success: false }) });

      await store.dispatch(authApi.endpoints.me.initiate());

      expect(store.getState().auth.token).toBe('valid-token');
      expect(store.getState().ui.toasts).toEqual([]);
    }
  );

  it('keeps the session when the request never reaches the server', async () => {
    const store = newStore();
    signIn(store, 'valid-token');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await store.dispatch(authApi.endpoints.me.initiate());

    expect(result).toMatchObject({ error: { status: 'FETCH_ERROR' } });
    expect(store.getState().auth.token).toBe('valid-token');
    expect(store.getState().ui.toasts).toEqual([]);
  });
});

describe('logout', () => {
  it('drops every cached query and the active workspace so the next user starts clean', async () => {
    const store = newStore();
    signIn(store, 'valid-token');
    store.dispatch(
      setWorkspace({
        id: 'ws-1',
        name: 'Demo workspace',
        currency: 'PLN',
        timezone: 'Europe/Warsaw',
        autonomyLevel: 'balanced',
      })
    );
    serve({
      '/api/auth/me': () =>
        json(200, {
          success: true,
          data: { id: userA.id, email: userA.email, workspaceId: 'ws-1' },
        }),
    });
    await store.dispatch(authApi.endpoints.me.initiate());
    expect(Object.keys(store.getState().api.queries)).toHaveLength(1);

    store.dispatch(logout());

    expect(store.getState().api.queries).toEqual({});
    expect(store.getState().api.mutations).toEqual({});
    expect(store.getState().workspace.id).toBeNull();
    expect(store.getState().workspace.name).toBe('');
  });

  it('also clears cached data and the workspace when the session expires', async () => {
    const store = newStore();
    signIn(store, 'expired-token');
    store.dispatch(
      setWorkspace({
        id: 'ws-1',
        name: 'Demo workspace',
        currency: 'PLN',
        timezone: 'Europe/Warsaw',
        autonomyLevel: 'balanced',
      })
    );
    serve({ '/api/auth/me': unauthorized });

    await store.dispatch(authApi.endpoints.me.initiate());

    expect(store.getState().api.queries).toEqual({});
    expect(store.getState().workspace.id).toBeNull();
  });
});
