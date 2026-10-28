import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { configureStore, type Middleware, type UnknownAction } from '@reduxjs/toolkit';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import type { UserPreferences } from '@shared/types';
import { baseApi } from '../state/api/baseApi';
import { settingsApi } from '../state/api/settingsApi';
import authReducer, { setCredentials } from '../state/slices/authSlice';
import uiReducer, { setThemeMode, type ThemeMode } from '../state/slices/uiSlice';
import workspaceReducer, { setWorkspace } from '../state/slices/workspaceSlice';
import { buildTheme } from './themeOptions';
import { useThemeToggle } from './useThemeToggle';

// RTK Query builds a Request from the base URL, and Node rejects the relative '/api'.
jest.mock('@shared/constants', () => ({
  ...jest.requireActual('@shared/constants'),
  API_BASE_URL: 'http://localhost/api',
}));

const principal = { workspaceId: 'ws-1', userId: 'user-a' };
const bootScript = readFileSync(path.join(process.cwd(), 'public/theme-boot.js'), 'utf8');

const dispatched: UnknownAction[] = [];
const recordActions: Middleware = () => (next) => (action) => {
  dispatched.push(action as UnknownAction);
  return next(action);
};

function buildStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      workspace: workspaceReducer,
      ui: uiReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(baseApi.middleware, recordActions),
  });
}

type TestStore = ReturnType<typeof buildStore>;

function signIn(store: TestStore) {
  store.dispatch(
    setCredentials({
      token: 'test-token',
      user: {
        id: principal.userId,
        email: 'user-a@example.test',
        workspaceId: principal.workspaceId,
        createdAt: '2026-07-14T00:00:00.000Z',
      },
    })
  );
  store.dispatch(
    setWorkspace({
      id: principal.workspaceId,
      name: 'Workspace',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      autonomyLevel: 'suggest_only',
    })
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function savedPreferences(themeMode: ThemeMode): UserPreferences {
  return { ...principal, themeMode, density: 'comfortable', revision: 1 };
}

// The device storage that public/theme-boot.js reads before React mounts.
let storage: Map<string, string>;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(initialMode: ThemeMode) {
  storage = new Map([['marketdesk.themeMode', initialMode]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
  });
}

function themePaintedOnNextLoad(prefersDark: boolean): string | undefined {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  vm.runInNewContext(bootScript, {
    window: {
      localStorage: globalThis.localStorage,
      matchMedia: () => ({ matches: prefersDark }),
    },
    document: { documentElement: root },
  });
  return root.dataset.theme;
}

// Renders the hook once (effects never run in this DOM-less suite, and the hook has none)
// and hands back what the top bar would hold on to.
function mountToggle(store: TestStore, themeInEffect: 'light' | 'dark') {
  let mounted: ReturnType<typeof useThemeToggle> | undefined;
  function Probe() {
    mounted = useThemeToggle();
    return null;
  }
  renderToStaticMarkup(
    <Provider store={store}>
      <ThemeProvider theme={buildTheme(themeInEffect)}>
        <Probe />
      </ThemeProvider>
    </Provider>
  );
  if (!mounted) throw new Error('useThemeToggle did not render');
  return mounted;
}

const fetchMock = jest.fn<Promise<Response>, [Request]>();
const realFetch = globalThis.fetch;
const stores: TestStore[] = [];

function createStore(initialMode: ThemeMode, { signedIn = true } = {}): TestStore {
  installStorage(initialMode);
  const store = buildStore();
  stores.push(store);
  store.dispatch(setThemeMode(initialMode));
  if (signedIn) signIn(store);
  return store;
}

describe('top bar theme toggle', () => {
  beforeEach(() => {
    dispatched.length = 0;
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    // Clears the RTK Query cache-removal timers so Jest can exit promptly.
    stores.splice(0).forEach((store) => store.dispatch(baseApi.util.resetApiState()));
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('persists the choice through the preferences endpoint when authenticated', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: savedPreferences('dark') })
    );
    const store = createStore('light');
    const toggle = mountToggle(store, 'light');

    await toggle.toggle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][0];
    expect(request.method).toBe('PATCH');
    expect(request.url).toBe('http://localhost/api/settings/preferences');
    expect(request.headers.get('authorization')).toBe('Bearer test-token');
    expect(await request.json()).toEqual({ themeMode: 'dark' });
    const started = dispatched.find(settingsApi.endpoints.updateUserPreferences.matchPending);
    expect(started?.meta.arg.originalArgs).toEqual({ principal, patch: { themeMode: 'dark' } });
    expect(store.getState().ui.themeMode).toBe('dark');
    expect(themePaintedOnNextLoad(false)).toBe('dark');
  });

  it('flips the theme in effect, not the stored mode, when the preference follows the system', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: savedPreferences('light') })
    );
    const store = createStore('system');
    const toggle = mountToggle(store, 'dark');

    await toggle.toggle();

    expect(await fetchMock.mock.calls[0][0].json()).toEqual({ themeMode: 'light' });
    expect(store.getState().ui.themeMode).toBe('light');
    expect(themePaintedOnNextLoad(true)).toBe('light');
  });

  it('reports the theme in effect so the control shows the mode it would switch away from', () => {
    const store = createStore('system');

    expect(mountToggle(store, 'dark').resolvedMode).toBe('dark');
    expect(mountToggle(store, 'light').resolvedMode).toBe('light');
  });

  it('changes the theme on this device only when nobody is signed in', async () => {
    const store = createStore('light', { signedIn: false });
    const toggle = mountToggle(store, 'light');

    await toggle.toggle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().ui.themeMode).toBe('dark');
    expect(themePaintedOnNextLoad(false)).toBe('dark');
  });

  it.each([
    [
      'the server rejects the save',
      () => jsonResponse(500, { success: false, error: { code: 'INTERNAL', message: 'boom' } }),
    ],
    [
      'the network is unreachable',
      () => {
        throw new TypeError('network down');
      },
    ],
  ])('restores the previous theme and reports it when %s', async (_case, respond) => {
    fetchMock.mockImplementation(async () => respond());
    const store = createStore('system');
    const toggle = mountToggle(store, 'light');

    await toggle.toggle();

    expect(store.getState().ui.themeMode).toBe('system');
    expect(themePaintedOnNextLoad(false)).toBe('light');
    expect(store.getState().ui.toasts).toEqual([
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/theme/i) }),
    ]);
  });
});
