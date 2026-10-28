import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { useTheme } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import type { UserPreferences } from '@shared/types';
import { baseApi } from '../state/api/baseApi';
import { settingsApi, type SettingsPrincipal } from '../state/api/settingsApi';
import authReducer, { setCredentials } from '../state/slices/authSlice';
import uiReducer from '../state/slices/uiSlice';
import workspaceReducer, { setWorkspace } from '../state/slices/workspaceSlice';
import { AppThemeProvider } from './ThemeProvider';

const principal: SettingsPrincipal = { workspaceId: 'ws-1', userId: 'user-a' };

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    ...principal,
    themeMode: 'light',
    density: 'comfortable',
    revision: 1,
    ...overrides,
  };
}

function buildStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      workspace: workspaceReducer,
      ui: uiReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });
}

type TestStore = ReturnType<typeof buildStore>;

const stores: TestStore[] = [];

function createStore(): TestStore {
  const store = buildStore();
  stores.push(store);
  return store;
}

function signIn(store: TestStore, userId = principal.userId) {
  store.dispatch(
    setCredentials({
      token: 'test-token',
      user: {
        id: userId,
        email: `${userId}@example.test`,
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

function cachePreferences(store: TestStore, cacheOwner: SettingsPrincipal, value: UserPreferences) {
  return store.dispatch(settingsApi.util.upsertQueryData('getUserPreferences', cacheOwner, value));
}

function ButtonSizeProbe() {
  const size = useTheme().components?.MuiButton?.defaultProps?.size;
  return <span data-button-size={size ?? 'default'} />;
}

function renderButtonSize(store: TestStore): string {
  const html = renderToStaticMarkup(
    <Provider store={store}>
      <AppThemeProvider>
        <ButtonSizeProbe />
      </AppThemeProvider>
    </Provider>
  );
  return /data-button-size="([^"]+)"/.exec(html)?.[1] ?? 'missing';
}

describe('AppThemeProvider density', () => {
  afterEach(() => {
    // Clears the RTK Query cache-removal timers so Jest can exit promptly.
    stores.splice(0).forEach((store) => store.dispatch(baseApi.util.resetApiState()));
  });

  it('uses the default control sizes before anyone is signed in', () => {
    expect(renderButtonSize(createStore())).toBe('default');
  });

  it('applies compact density from the signed-in principal preferences', async () => {
    const store = createStore();
    signIn(store);
    await cachePreferences(store, principal, preferences({ density: 'compact' }));

    expect(renderButtonSize(store)).toBe('small');
  });

  it('keeps comfortable density for comfortable preferences', async () => {
    const store = createStore();
    signIn(store);
    await cachePreferences(store, principal, preferences({ density: 'comfortable' }));

    expect(renderButtonSize(store)).toBe('default');
  });

  it('falls back to comfortable when the stored preferences carry no density', async () => {
    const store = createStore();
    signIn(store);
    const legacy = { ...preferences(), density: undefined } as unknown as UserPreferences;
    await cachePreferences(store, principal, legacy);

    expect(renderButtonSize(store)).toBe('default');
  });

  it("does not apply another principal's compact preference", async () => {
    const store = createStore();
    signIn(store);
    const other = { ...principal, userId: 'user-b' };
    await cachePreferences(store, other, preferences({ ...other, density: 'compact' }));

    expect(renderButtonSize(store)).toBe('default');
  });
});
