import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Marketplace } from '@shared/types';
import type { ConfirmDialogProps } from '../components/common/ConfirmDialog';
import type { MarketplaceCardProps } from '../components/marketplaces/MarketplaceCard';
import type { MarketplaceConfigureDrawerProps } from '../components/marketplaces/MarketplaceConfigureDrawer';
import type { MarketplaceOAuthStatus } from '../state/api/index.js';
import MarketplacesPage, { oauthReturnToast } from './MarketplacesPage';

// Props the page last passed to its children. Server rendering never runs
// effects and ignores state updates after render, so tests drive the page's
// handlers through these captured callbacks.
const mockCapture: {
  card?: MarketplaceCardProps;
  drawer?: MarketplaceConfigureDrawerProps;
  confirm?: ConfirmDialogProps;
} = {};
const mockMarketplaces = jest.fn();
const mockConnection = jest.fn();
const mockOverview = jest.fn();
const mockCredentials = jest.fn();
const mockSync = jest.fn();
const mockConnect = jest.fn();
const mockUpdate = jest.fn();
const mockSaveCredentials = jest.fn();
const mockDispatch = jest.fn();

jest.mock('../services/hooks/index.js', () => ({
  useMarketplaces: () => mockMarketplaces(),
  useMarketplaceConnection: (id: string, options: unknown) => mockConnection(id, options),
  useAnalyticsOverview: (params: unknown, options: unknown) => mockOverview(params, options),
  useMarketplaceAppCredentials: (id: string, options: unknown) => mockCredentials(id, options),
  useSaveMarketplaceAppCredentials: () => [mockSaveCredentials, { isLoading: false }],
  useSyncMarketplace: () => [mockSync],
  useConnectMarketplace: () => [mockConnect],
  useCheckMarketplace: () => [jest.fn()],
  useUpdateMarketplace: () => [mockUpdate],
}));

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => mockDispatch,
}));

jest.mock('../components/marketplaces/MarketplaceCard.js', () => {
  const actual = jest.requireActual('../components/marketplaces/MarketplaceCard');
  return {
    ...actual,
    MarketplaceCard: (props: MarketplaceCardProps) => {
      mockCapture.card = props;
      return actual.MarketplaceCard(props);
    },
  };
});

jest.mock('../components/marketplaces/MarketplaceConfigureDrawer.js', () => {
  const actual = jest.requireActual('../components/marketplaces/MarketplaceConfigureDrawer');
  return {
    ...actual,
    MarketplaceConfigureDrawer: (props: MarketplaceConfigureDrawerProps) => {
      mockCapture.drawer = props;
      return actual.MarketplaceConfigureDrawer(props);
    },
  };
});

jest.mock('../components/common/ConfirmDialog.js', () => {
  const actual = jest.requireActual('../components/common/ConfirmDialog');
  return {
    ...actual,
    ConfirmDialog: (props: ConfirmDialogProps) => {
      mockCapture.confirm = props;
      return actual.ConfirmDialog(props);
    },
  };
});

function olx(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    sandbox: false,
    syncMode: 'manual',
    lastSyncAt: undefined,
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

interface Setup {
  marketplaces?: Marketplace[];
  check?: { connected: boolean; sandbox: boolean } | null;
  credentialsConfigured?: boolean;
}

function setup({
  marketplaces = [olx()],
  check = { connected: true, sandbox: false },
  credentialsConfigured = true,
}: Setup = {}): void {
  mockMarketplaces.mockReturnValue({
    data: marketplaces,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: jest.fn(),
  });
  mockConnection.mockReturnValue({
    data: check
      ? { ...check, marketplaceId: 'marketplace-olx', providerKey: 'olx', account: null, refreshable: false }
      : undefined,
  });
  mockOverview.mockImplementation((params?: { marketplaceId?: string }) => ({
    data: { liveListingCount: params?.marketplaceId ? 9 : 12 },
  }));
  mockCredentials.mockReturnValue({
    data: { configured: credentialsConfigured, marketplaceId: 'marketplace-olx', providerKey: 'olx' },
  });
}

function renderPage(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/marketplaces']}>
      <MarketplacesPage />
    </MemoryRouter>,
  );
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

function toast(message: string, severity: string) {
  return expect.objectContaining({ payload: expect.objectContaining({ message, severity }) });
}

describe('MarketplacesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete mockCapture.card;
    delete mockCapture.drawer;
    delete mockCapture.confirm;
    setup();
  });

  it('renders the OLX card and nothing else', () => {
    const html = renderPage();

    expect(count(html, '<section')).toBe(1);
    expect(count(html, 'aria-label="OLX logo"')).toBe(1);
    expect(html).not.toContain('Not available yet');
    expect(html).not.toContain('marketplaces connected');
    expect(html).not.toContain('Preview import');
    expect(html).not.toContain('Import eligible');
  });

  it('ignores a stored marketplace that is not OLX', () => {
    setup({
      marketplaces: [
        olx(),
        { ...olx(), id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true },
      ],
    });
    const html = renderPage();

    expect(count(html, '<section')).toBe(1);
    expect(html).not.toContain('Allegro');
  });

  it('sandbox badge shown when marketplace.sandbox', () => {
    setup({ marketplaces: [olx({ sandbox: true, connected: false })], check: { connected: false, sandbox: false } });
    const sandboxHtml = renderPage();
    setup({ marketplaces: [olx({ connected: false })], check: { connected: false, sandbox: false } });
    const realHtml = renderPage();

    expect(count(sandboxHtml, '>Sandbox</span>')).toBe(1);
    expect(sandboxHtml).toContain('Connect sandbox OLX');
    expect(realHtml).not.toContain('>Sandbox</span>');
    expect(realHtml).toContain('Connect with OLX');
  });

  it('drives the OLX connection state from the OAuth check, not the list flag', () => {
    setup({ marketplaces: [olx({ connected: true })], check: { connected: false, sandbox: false } });
    const html = renderPage();

    expect(mockConnection).toHaveBeenCalledWith('marketplace-olx', { skip: false });
    expect(html).toContain('>Disconnected</');
    expect(html).toContain('Connect with OLX');
  });

  it('falls back to the list flag until the OAuth check answers', () => {
    setup({ marketplaces: [olx({ connected: true })], check: null });

    expect(renderPage()).toContain('>Connected</');
  });

  it('shows the OLX live listing count from analytics', () => {
    const html = renderPage();

    expect(mockOverview).toHaveBeenCalledWith({ marketplaceId: 'marketplace-olx' }, { skip: false });
    expect(html).toContain('>9 live</dd>');
  });

  it('asks for OLX app credentials before a real connect', () => {
    setup({
      marketplaces: [olx({ connected: false })],
      check: { connected: false, sandbox: false },
      credentialsConfigured: false,
    });

    expect(renderPage()).toContain('Add your OLX app credentials in Configure before connecting.');
    expect(mockCredentials).toHaveBeenCalledWith('marketplace-olx', { skip: false });
  });

  it('does not ask for app credentials in sandbox mode', () => {
    setup({
      marketplaces: [olx({ sandbox: true, connected: false })],
      check: { connected: false, sandbox: false },
      credentialsConfigured: false,
    });

    expect(renderPage()).not.toContain('Add your OLX app credentials');
  });

  it('shows placeholders while marketplaces load', () => {
    mockMarketplaces.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
    });
    const html = renderPage();

    expect(count(html, 'class="MuiSkeleton-root')).toBe(1);
    expect(html).not.toContain('marketplaces connected');
    expect(html).not.toContain('aria-label="OLX logo"');
  });

  it('says when the workspace has no OLX marketplace record', () => {
    setup({ marketplaces: [] });
    const html = renderPage();

    expect(mockConnection).toHaveBeenCalledWith('', { skip: true });
    expect(html).toContain('OLX is not set up');
    expect(html).not.toContain('Connect with OLX');
  });

  it('shows a retry card when marketplaces fail to load', () => {
    mockMarketplaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 500 },
      refetch: jest.fn(),
    });
    const html = renderPage();

    expect(html).toContain('Try again');
    expect(html).not.toContain('marketplaces connected');
  });

  it('Sync now queues a sync for the OLX marketplace', async () => {
    setup({
      marketplaces: [
        olx(),
        { ...olx(), id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true },
      ],
    });
    mockSync.mockReturnValue({ unwrap: () => Promise.resolve({ marketplaceId: 'marketplace-olx', enqueued: true }) });
    renderPage();

    await mockCapture.card?.onSync(olx());

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith('marketplace-olx');
    expect(mockDispatch).toHaveBeenCalledWith(toast('Sync queued for OLX.', 'success'));
  });

  it('labels a sandbox sync and reports a failed one', async () => {
    setup({ marketplaces: [olx({ sandbox: true })], check: { connected: true, sandbox: true } });
    mockSync.mockReturnValue({
      unwrap: () => Promise.reject({ data: { error: { message: 'Sync queue unavailable' } } }),
    });
    renderPage();

    await mockCapture.card?.onSync(olx({ sandbox: true }));

    expect(mockDispatch).toHaveBeenCalledWith(
      toast('OLX (sandbox) sync failed: Sync queue unavailable', 'error'),
    );
  });

  it('disconnects only after the confirmation dialog', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(olx({ connected: false })) });
    renderPage();

    mockCapture.card?.onRequestDisconnect(olx());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCapture.confirm?.title).toBe('Disconnect OLX?');
    expect(mockCapture.confirm?.confirmColor).toBe('error');

    await mockCapture.confirm?.onConfirm();

    expect(mockUpdate).toHaveBeenCalledWith({ id: 'marketplace-olx', patch: { connected: false } });
    expect(mockDispatch).toHaveBeenCalledWith(
      toast('OLX disconnected. Listings stay in MarketDesk.', 'success'),
    );
  });

  it('saves a new sync mode from the Configure drawer', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(olx({ syncMode: 'hourly' })) });
    renderPage();

    await mockCapture.drawer?.onSyncModeChange(olx(), 'hourly');

    expect(mockUpdate).toHaveBeenCalledWith({ id: 'marketplace-olx', patch: { syncMode: 'hourly' } });
    expect(mockDispatch).toHaveBeenCalledWith(toast('OLX sync mode updated.', 'success'));
  });

  it('saves OLX app credentials from the Configure drawer', async () => {
    mockSaveCredentials.mockReturnValue({
      unwrap: () => Promise.resolve({ configured: true, marketplaceId: 'marketplace-olx', providerKey: 'olx' }),
    });
    renderPage();

    const saved = await mockCapture.drawer?.onSaveCredentials({ clientId: 'client-1', clientSecret: 'secret-1' });

    expect(saved).toBe(true);
    expect(mockSaveCredentials).toHaveBeenCalledWith({
      id: 'marketplace-olx',
      input: { clientId: 'client-1', clientSecret: 'secret-1' },
    });
    expect(mockDispatch).toHaveBeenCalledWith(toast('OLX application credentials saved.', 'success'));
  });

  it('keeps the credentials form filled when saving fails', async () => {
    mockSaveCredentials.mockReturnValue({
      unwrap: () => Promise.reject({ data: { error: { message: 'OLX application client ID is required' } } }),
    });
    renderPage();

    const saved = await mockCapture.drawer?.onSaveCredentials({ clientId: '', clientSecret: 'secret-1' });

    expect(saved).toBe(false);
    expect(mockDispatch).toHaveBeenCalledWith(toast('OLX application client ID is required', 'error'));
  });

  it('starts the OLX connect flow and follows the authorization URL', async () => {
    setup({ marketplaces: [olx({ connected: false })], check: { connected: false, sandbox: false } });
    mockConnect.mockReturnValue({
      unwrap: () => Promise.resolve({ authorizationUrl: 'https://auth.example.test/authorize' }),
    });
    const assign = jest.fn();
    renderPage();

    Object.defineProperty(globalThis, 'window', { value: { location: { assign } }, configurable: true });
    try {
      await mockCapture.card?.onConnect(olx({ connected: false }));
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }

    expect(mockConnect).toHaveBeenCalledWith({ id: 'marketplace-olx' });
    expect(assign).toHaveBeenCalledWith('https://auth.example.test/authorize');
  });
});

describe('oauthReturnToast', () => {
  function checkStatus(overrides: Partial<MarketplaceOAuthStatus> = {}): MarketplaceOAuthStatus {
    return {
      connected: true,
      marketplaceId: 'marketplace-olx',
      providerKey: 'olx',
      account: { id: 'account-1', handle: 'seller', status: 'connected', scopes: ['read', 'write'] },
      refreshable: true,
      sandbox: false,
      ...overrides,
    };
  }

  it('gives a real account the plain toast even when the return URL says sandbox=1', () => {
    // The wording depends on the server's check() result alone, so a
    // user-supplied `?sandbox=1` on a real deployment cannot reach it.
    expect(oauthReturnToast).toHaveLength(1);
    expect(oauthReturnToast(checkStatus())).toEqual({
      message: 'OLX account connected.',
      severity: 'success',
    });
  });

  it('announces a sandbox account without implying real OLX calls', () => {
    expect(oauthReturnToast(checkStatus({ sandbox: true }))).toEqual({
      message: 'Sandbox OLX connected — no real marketplace calls are made',
      severity: 'success',
    });
  });

  it('reports an error when check() says the account is not connected', () => {
    expect(oauthReturnToast(checkStatus({ connected: false, sandbox: true }))).toEqual({
      message: 'OLX account is not connected.',
      severity: 'error',
    });
  });
});
