import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { IntegrationsSettings, UserPreferences, WorkspaceSettings } from '@shared/types';
import { baseApi } from '../state/api/baseApi';
import { settingsApi, type SettingsPrincipal } from '../state/api/settingsApi';
import authReducer, { setCredentials } from '../state/slices/authSlice';
import uiReducer from '../state/slices/uiSlice';
import workspaceReducer, { setWorkspace } from '../state/slices/workspaceSlice';
import { lightTheme } from '../theme/lightTheme';
import { withoutStyleTags } from '../testkit/staticMarkup';
import SettingsPage from './SettingsPage';

const principal: SettingsPrincipal = { workspaceId: 'ws-1', userId: 'user-a' };
const updatedAt = '2026-07-14T00:00:00.000Z';

const workspaceSettings: WorkspaceSettings = {
  id: 'ws-1',
  name: 'Demo workspace',
  currency: 'PLN',
  timezone: 'Europe/Warsaw',
  language: 'en',
  updatedAt,
};

const preferences: UserPreferences = {
  ...principal,
  themeMode: 'system',
  density: 'compact',
  revision: 1,
};

const integrations: IntegrationsSettings = {
  items: [
    {
      category: 'marketplace',
      id: 'marketplace-olx',
      providerKey: 'olx',
      name: 'OLX',
      available: true,
      configured: true,
      connected: true,
      account: { handle: 'seller@example.test', status: 'connected' },
      sandbox: true,
    },
  ],
};

async function renderSettings(url: string): Promise<string> {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      workspace: workspaceReducer,
      ui: uiReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });
  store.dispatch(
    setCredentials({
      token: 'test-token',
      user: {
        id: principal.userId,
        email: 'user-a@example.test',
        workspaceId: principal.workspaceId,
        createdAt: updatedAt,
      },
    })
  );
  store.dispatch(
    setWorkspace({
      id: principal.workspaceId,
      name: workspaceSettings.name,
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      autonomyLevel: 'balanced',
    })
  );
  const { util } = settingsApi;
  await Promise.all([
    store.dispatch(util.upsertQueryData('getWorkspaceSettings', principal, workspaceSettings)),
    store.dispatch(util.upsertQueryData('getUserPreferences', principal, preferences)),
    store.dispatch(util.upsertQueryData('getIntegrationSettings', principal, integrations)),
  ]);

  try {
    return withoutStyleTags(
      renderToStaticMarkup(
        <Provider store={store}>
          <ThemeProvider theme={lightTheme}>
            <MemoryRouter initialEntries={[url]}>
              <SettingsPage />
            </MemoryRouter>
          </ThemeProvider>
        </Provider>
      )
    );
  } finally {
    // Clears the RTK Query cache-removal timers so Jest can exit promptly.
    store.dispatch(baseApi.util.resetApiState());
  }
}

const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const currentSection = (html: string) => {
  const button = /<button[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  return button ? visibleText(button[1]!) : undefined;
};

describe('SettingsPage sections', () => {
  it('opens General by default', async () => {
    const html = await renderSettings('/settings');
    const text = visibleText(html);

    expect(currentSection(html)).toBe('General');
    expect(text).toContain('Workspace name');
    expect(text).toContain('Save changes');
  });

  it('ignores an unknown ?section= value', async () => {
    expect(currentSection(await renderSettings('/settings?section=nope'))).toBe('General');
  });

  it('renders Marketplace Accounts from the integrations payload with the sandbox marker', async () => {
    const html = await renderSettings('/settings?section=marketplaces');
    const text = visibleText(html);

    expect(currentSection(html)).toBe('Marketplace Accounts');
    expect(text).toContain('seller@example.test');
    expect(text).toContain('Connected');
    expect(text).toContain('Sandbox');
    expect(html).toMatch(/href="\/marketplaces"/);
  });

  it('renders Appearance with labelled Theme and Density controls', async () => {
    const html = await renderSettings('/settings?section=appearance');
    const text = visibleText(html);

    expect(currentSection(html)).toBe('Appearance');
    expect(text).toContain('Theme');
    expect(text).toContain('Density');
    expect(text).toContain('Compact');
  });
});
