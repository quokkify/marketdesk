import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Marketplace } from '@shared/types';
import type { ConfirmDialogProps } from '../components/common/ConfirmDialog';
import type { MarketplaceCardProps } from '../components/marketplaces/MarketplaceCard';
import type { MarketplaceConfigureDrawerProps } from '../components/marketplaces/MarketplaceConfigureDrawer';
import type { MarketplaceSummaryBarProps } from '../components/marketplaces/MarketplaceSummaryBar';
import { ROADMAP_CARD_COPY } from '../components/marketplaces/RoadmapMarketplaceCard';
import type { MarketplaceOAuthStatus } from '../state/api/index.js';
import MarketplacesPage, { oauthReturnToast } from './MarketplacesPage';

// Props the page last passed to its children. Server rendering never runs
// effects and ignores state updates after render, so tests drive the page's
// handlers through these captured callbacks.
const mockCapture: {
  summary?: MarketplaceSummaryBarProps;
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
  useImportMarketplacePreview: () => [jest.fn()],
  useImportMarketplaceAdverts: () => [jest.fn()],
  useUpdateMarketplace: () => [mockUpdate],
}));

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => mockDispatch,
}));

jest.mock('../components/marketplaces/MarketplaceSummaryBar.js', () => {
  const actual = jest.requireActual('../components/marketplaces/MarketplaceSummaryBar');
  return {
    ...actual,
    MarketplaceSummaryBar: (props: MarketplaceSummaryBarProps) => {
      mockCapture.summary = props;
      return actual.MarketplaceSummaryBar(props);
    },
  };
});

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

const ROADMAP_NAMES = ['Allegro', 'Vinted', 'Facebook Marketplace', 'eBay', 'Etsy', 'Amazon'];

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
    delete mockCapture.summary;
    delete mockCapture.card;
    delete mockCapture.drawer;
    delete mockCapture.confirm;
    setup();
  });

  it('renders one OLX card and six roadmap cards', () => {
    const html = renderPage();

    expect(count(html, '<section')).toBe(7);
    expect(count(html, 'aria-label="OLX logo"')).toBe(1);
    expect(count(html, ROADMAP_CARD_COPY)).toBe(6);
    expect(count(html, '>Not available yet</span>')).toBe(6);
    for (const name of ROADMAP_NAMES) {
      expect(html).toContain(`>${name}</h2>`);
    }
  });

  it('roadmap cards expose no connect action', () => {
    setup({
      marketplaces: [
        olx(),
        { ...olx(), id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true },
      ],
    });
    const html = renderPage();

    expect(count(html, '>Allegro</h2>')).toBe(1);
    expect(count(html, '(not available yet)"')).toBe(6);
    expect(html).not.toMatch(/Connect (with|sandbox) (?!OLX)/);
    expect(html).toContain('>1 of 7 marketplaces connected</');
  });

  it('sandbox badge shown when marketplace.sandbox', () => {
    setup({ marketplaces: [olx({ sandbox: true, connected: false })], check: { connected: false, sandbox: false } });
    const sandboxHtml = renderPage();
    const sandboxSummary = mockCapture.summary;
    setup({ marketplaces: [olx({ connected: false })], check: { connected: false, sandbox: false } });
    const realHtml = renderPage();

    expect(sandboxSummary?.sandbox).toBe(true);
    expect(count(sandboxHtml, '>Sandbox</span>')).toBe(2);
    expect(sandboxHtml).toContain('Connect sandbox OLX');
    expect(mockCapture.summary?.sandbox).toBe(false);
    expect(realHtml).not.toContain('>Sandbox</span>');
    expect(realHtml).toContain('Connect with OLX');
  });

  it('drives the OLX connection state from the OAuth check, not the list flag', () => {
    setup({ marketplaces: [olx({ connected: true })], check: { connected: false, sandbox: false } });
    const html = renderPage();

    expect(mockConnection).toHaveBeenCalledWith('marketplace-olx', { skip: false });
    expect(html).toContain('>Disconnected</');
    expect(html).toContain('>0 of 7 marketplaces connected</');
    expect(html).toContain('Connect with OLX');
  });

  it('falls back to the list flag until the OAuth check answers', () => {
    setup({ marketplaces: [olx({ connected: true })], check: null });

    expect(renderPage()).toContain('>1 of 7 marketplaces connected</');
  });

  it('shows workspace and OLX live listing counts from analytics', () => {
    const html = renderPage();

    expect(mockOverview).toHaveBeenCalledWith({ marketplaceId: 'marketplace-olx' }, { skip: false });
    expect(html).toContain('>9 live</dd>');
    expect(html).toContain('12 active listings');
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

  it('shows placeholders while marketplaces load and keeps the roadmap visible', () => {
    mockMarketplaces.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
    });
    const html = renderPage();

    expect(count(html, 'class="MuiSkeleton-root')).toBe(2);
    expect(html).not.toContain('marketplaces connected');
    expect(html).not.toContain('aria-label="OLX logo"');
    expect(count(html, ROADMAP_CARD_COPY)).toBe(6);
  });

  it('says when the workspace has no OLX marketplace record', () => {
    setup({ marketplaces: [] });
    const html = renderPage();

    expect(mockConnection).toHaveBeenCalledWith('', { skip: true });
    expect(html).toContain('OLX is not set up');
    expect(html).toContain('>0 of 7 marketplaces connected</');
    expect(html).not.toContain('Connect with OLX');
    expect(count(html, ROADMAP_CARD_COPY)).toBe(6);
  });

  it('shows a retry card when marketplaces fail to load and keeps the roadmap visible', () => {
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
    expect(count(html, ROADMAP_CARD_COPY)).toBe(6);
  });

  it('Sync all queues a sync for the connected OLX marketplace only', async () => {
    setup({
      marketplaces: [
        olx(),
        { ...olx(), id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true },
      ],
    });
    mockSync.mockReturnValue({ unwrap: () => Promise.resolve({ marketplaceId: 'marketplace-olx', enqueued: true }) });
    renderPage();

    await mockCapture.summary?.onSyncAll();

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

    await mockCapture.summary?.onSyncAll();

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
