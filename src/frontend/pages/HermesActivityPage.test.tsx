import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@mui/material';
import type { HermesEvent, HermesStatusView, Marketplace } from '@shared/types';
import HermesActivityPage, {
  HERMES_SETTINGS_PATH,
  HermesFeedFooter,
  HermesHero,
  HermesMetrics,
} from './HermesActivityPage';
import { HERMES_OFFLINE_TOOLTIP } from './hermesActivityState';

const mockUseHermesEvents = jest.fn();
const mockUseHermesEventFeed = jest.fn();
const mockUseHermesStatus = jest.fn();
const mockUseAnalyticsOverview = jest.fn();
const mockUseMarketplaces = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => 'PLN',
}));

jest.mock('../services/hooks/index.js', () => ({
  useHermesEvents: (params: unknown) => mockUseHermesEvents(params),
  useHermesEventFeed: (filters: unknown) => mockUseHermesEventFeed(filters),
  useHermesStatus: () => mockUseHermesStatus(),
  useAnalyticsOverview: () => mockUseAnalyticsOverview(),
  useMarketplaces: () => mockUseMarketplaces(),
  useApproveHermesEvent: () => [jest.fn(), { isLoading: false }],
  useDismissHermesEvent: () => [jest.fn(), { isLoading: false }],
  useExecuteCategoryRecreationOperation: () => [jest.fn(), { isLoading: false }],
}));

// 24 Oct 2026, 15:30 local time; "today" in the stat tiles starts at 00:00 local.
const NOW = new Date(2026, 9, 24, 15, 30);

const event = (id: string, createdAt: Date, overrides: Partial<HermesEvent> = {}): HermesEvent => ({
  id,
  workspaceId: 'workspace-1',
  productId: 'product-1',
  type: 'suggested_lower_price',
  severity: 'warning',
  status: 'pending_review',
  title: `Review price ${id}`,
  detail: 'A recorded suggestion.',
  proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
  createdAt: createdAt.toISOString(),
  ...overrides,
});

const LATEST_EVENTS = [
  event('today-late', new Date(2026, 9, 24, 14, 0)),
  event('today-early', new Date(2026, 9, 24, 8, 0)),
  event('yesterday', new Date(2026, 9, 23, 21, 0)),
];

const query = <T,>(data: T | undefined, overrides: Record<string, unknown> = {}) => ({
  data,
  isLoading: data === undefined,
  isFetching: false,
  isError: false,
  error: undefined,
  refetch: jest.fn(),
  ...overrides,
});

// A settled feed for the current filter set: RTK Query reports the same result as `data`
// and as `currentData`.
const feed = (items: HermesEvent[], total: number, overrides: Record<string, unknown> = {}) => {
  const result = { pages: [{ items, total, page: 1, limit: 20, totalPages: 1 }], pageParams: [0] };
  return {
    data: result,
    currentData: result,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: items.length < total,
    isError: false,
    error: undefined,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    ...overrides,
  };
};

// What RTK Query reports right after the filters changed. `data` still holds the previous
// filter set's result and `isLoading` stays false, but nothing exists for the new filter
// set yet, so `currentData` is undefined.
const afterFilterChange = (overrides: Record<string, unknown> = {}) => ({
  ...feed(LATEST_EVENTS, LATEST_EVENTS.length),
  currentData: undefined,
  hasNextPage: false,
  ...overrides,
});

const offlineStatus: HermesStatusView = {
  mode: 'auto',
  activeProvider: 'offline',
  hermesConfigured: false,
  hermesReachable: null,
  checkedAt: '2026-10-24T10:00:00.000Z',
};

const olx = (overrides: Partial<Marketplace> = {}): Marketplace => ({
  id: 'marketplace-olx',
  workspaceId: 'workspace-1',
  key: 'olx',
  name: 'OLX',
  connected: true,
  sandbox: false,
  syncMode: 'manual',
  errorCount: 0,
  capacity: 100,
  createdAt: '2026-07-14T00:00:00.000Z',
  ...overrides,
});

const TOTALS_BY_STATUS: Record<string, number> = { pending_review: 3, applied: 31, dismissed: 5 };

const render = (props: React.ComponentProps<typeof HermesActivityPage> = {}) =>
  renderToStaticMarkup(<HermesActivityPage {...props} />);

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  mockUseHermesEvents.mockReset().mockImplementation((params: { limit?: number; status?: string[] }) =>
    params.limit === 1
      ? query({ items: [], total: TOTALS_BY_STATUS[params.status?.[0] ?? ''] ?? 0 })
      : query({ items: LATEST_EVENTS, total: LATEST_EVENTS.length }),
  );
  mockUseHermesEventFeed.mockReset().mockImplementation(() => feed(LATEST_EVENTS, LATEST_EVENTS.length));
  mockUseHermesStatus.mockReset().mockImplementation(() => query(offlineStatus));
  mockUseAnalyticsOverview.mockReset().mockImplementation(() => query({ liveListingCount: 12 }));
  mockUseMarketplaces.mockReset().mockImplementation(() => query([olx()]));
});

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}

function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (React.isValidElement(node)) return textContent((node as ElementLike).props.children);
  return '';
}

describe('Hermes banner', () => {
  it('renders the Hermes AI identity on the companion gradient with a real Configure target', () => {
    const html = render();

    expect(HERMES_SETTINGS_PATH).toBe('/settings?section=hermes');
    expect(html).toContain('>Hermes AI<');
    expect(html).toContain('linear-gradient(135deg, #5B5BD6, #A24BD6)');
    expect(html).toContain('Configure');
    expect(html).toContain('Select product to analyze');
    expect(html).toContain('Whole-catalogue runs are not started from the UI');
    expect(html).toContain('Analyze with Hermes');
    expect(html).not.toContain('Run Hermes');
  });

  it('drops the claims the page cannot back', () => {
    const html = render();

    expect(html).not.toContain('Ready on demand');
    expect(html).not.toContain('Hermes AI agent');
    expect(html).not.toContain('Unavailable');
    expect(html).not.toContain('Listings created');
    expect(html).not.toContain('Time saved');
  });

  it('says it runs on built-in heuristics, with the reason, while Hermes is offline', () => {
    const html = render();

    expect(html).toContain('Offline heuristics');
    expect(html).toContain(HERMES_OFFLINE_TOOLTIP);
    expect(html).not.toContain('Hermes connected');
  });

  it('says Hermes is connected when it is the active provider and answers', () => {
    mockUseHermesStatus.mockImplementation(() =>
      query({
        ...offlineStatus,
        activeProvider: 'hermes',
        hermesConfigured: true,
        hermesReachable: true,
      }),
    );

    const html = render();

    expect(html).toContain('Hermes connected');
    expect(html).not.toContain('Offline heuristics');
  });

  it('reports what Hermes is watching from the live listing and marketplace counts', () => {
    const html = render();

    expect(html).toContain('Watching 12 live listings on 1 marketplace');
    expect(html).not.toContain('Sandbox');
  });

  it('labels the sandbox when the watched marketplace is a sandbox', () => {
    mockUseMarketplaces.mockImplementation(() => query([olx({ sandbox: true })]));

    expect(render()).toContain('Sandbox');
  });

  it('refuses to state counts it could not load', () => {
    mockUseAnalyticsOverview.mockImplementation(() =>
      query(undefined, { isLoading: false, isError: true }),
    );

    const html = render();

    expect(html).toContain('Live listing and marketplace counts could not be loaded.');
    expect(html).not.toContain('Watching');
  });

  it('wires Configure and product selection to the callbacks it is given', () => {
    const onConfigure = jest.fn();
    const onSelectProduct = jest.fn();
    const hero = HermesHero({
      provider: { label: 'Offline heuristics', color: 'warning' },
      watching: { kind: 'loading' },
      onConfigure,
      onSelectProduct,
    }) as ElementLike;
    const buttons = findByType(hero, Button);
    const byLabel = (label: string) => buttons.find((button) => textContent(button).includes(label));

    (byLabel('Configure')?.props.onClick as () => void)();
    (byLabel('Select product to analyze')?.props.onClick as () => void)();

    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onSelectProduct).toHaveBeenCalledTimes(1);
  });
});

describe('Hermes stat tiles', () => {
  it('shows the four honest tiles from the list endpoints', () => {
    const html = render();

    for (const label of ['Actions today', 'Awaiting review', 'Completed', 'Dismissed']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('>3<');
    expect(html).toContain('>31<');
    expect(html).toContain('>5<');
  });

  it('counts today among the latest loaded events and says so', () => {
    const html = render();

    expect(html).toContain('>2<');
    expect(html).toContain('of the latest 3 loaded');
  });

  it('asks the API for authoritative totals instead of counting the loaded page', () => {
    render();

    const requested = mockUseHermesEvents.mock.calls.map(([params]) => params);
    for (const status of ['pending_review', 'applied', 'dismissed']) {
      expect(requested).toContainEqual(expect.objectContaining({ status: [status], limit: 1 }));
    }
  });

  it('shows a dash with the reason when a count cannot be loaded', () => {
    mockUseHermesEvents.mockImplementation((params: { limit?: number; status?: string[] }) =>
      params.status?.[0] === 'applied'
        ? query(undefined, { isLoading: false, isError: true })
        : query({ items: [], total: 4 }),
    );

    const html = render();

    expect(html).toContain('>—<');
    expect(html).toContain('Could not be loaded');
  });

  it('renders a skeleton instead of a number while a count loads', () => {
    const html = renderToStaticMarkup(
      <HermesMetrics metrics={[{ label: 'Completed', value: null, caption: 'applied, all time' }]} />,
    );

    expect(html).toContain('MuiSkeleton');
    expect(html).toContain('>Completed<');
  });
});

describe('Hermes tabs and server-side filters', () => {
  it('lists the four PRD tabs', () => {
    const html = render();

    for (const label of ['All activity', 'Suggestions', 'Alerts', 'Completed']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('All statuses');
    expect(html).toContain('All severities');
  });

  it.each([
    ['all', { sort: '-createdAt' }],
    ['suggestions', { status: ['pending_decision', 'pending_review'], sort: '-createdAt' }],
    ['alerts', { severity: ['warning', 'critical'], sort: '-createdAt' }],
    ['completed', { status: ['applied', 'dismissed', 'reverted'], sort: '-createdAt' }],
  ] as const)('asks the server for the %s tab instead of filtering the loaded page', (tab, filters) => {
    render({ initialTab: tab });

    expect(mockUseHermesEventFeed).toHaveBeenLastCalledWith(filters);
  });

  it('shows what the server returned for the tab without filtering it again', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      feed([event('applied-one', NOW, { status: 'applied', severity: 'success' })], 1),
    );

    const html = render({ initialTab: 'alerts' });

    expect(html).toContain('Review price applied-one');
  });
});

describe('Hermes feed paging', () => {
  it('offers Load more while pagination.total counts more events than are loaded', () => {
    mockUseHermesEventFeed.mockImplementation(() => feed(LATEST_EVENTS, 45));

    const html = render();

    expect(html).toContain('Load more');
    expect(html).toContain('Showing 3 of 45');
  });

  it('hides Load more once everything is loaded', () => {
    const html = render();

    expect(html).not.toContain('Load more');
    expect(html).toContain('Showing 3 of 3');
  });

  it('disables the button and says so while the next page loads', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      feed(LATEST_EVENTS, 45, { isFetchingNextPage: true }),
    );

    const html = render();

    expect(html).toContain('Loading…');
    expect(html).not.toContain('>Load more<');
  });

  it('asks for the next page when Load more is pressed', () => {
    const onLoadMore = jest.fn();
    const footer = HermesFeedFooter({
      loaded: 20,
      total: 45,
      hasMore: true,
      loadingMore: false,
      onLoadMore,
    }) as ElementLike;
    const [button] = findByType(footer, Button);

    (button.props.onClick as () => void)();

    expect(textContent(button)).toBe('Load more');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('keeps the list on screen while a background refetch runs', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      feed(LATEST_EVENTS, LATEST_EVENTS.length, { isFetching: true }),
    );

    const html = render();

    expect(html).toContain('Review price today-late');
    expect(html).not.toContain('MuiSkeleton');
  });
});

describe('Hermes feed states', () => {
  it('shows skeleton cards while the feed loads', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      query(undefined, { isFetching: true, isFetchingNextPage: false, hasNextPage: false }),
    );

    const html = render();

    expect(html).toContain('MuiSkeleton');
    expect(html).not.toContain('Review price');
  });

  it('keeps the product-scoped analysis wording for an empty feed', () => {
    mockUseHermesEventFeed.mockImplementation(() => feed([], 0));

    const html = render();

    expect(html).toContain('No product analysis activity');
    expect(html).toContain('Select a product and use Analyze with Hermes');
  });

  it.each([
    ['suggestions', 'No suggestions to review'],
    ['alerts', 'No alerts'],
    ['completed', 'Nothing completed yet'],
  ] as const)('names the empty %s tab instead of the whole feed', (tab, title) => {
    mockUseHermesEventFeed.mockImplementation(() => feed([], 0));

    const html = render({ initialTab: tab });

    expect(html).toContain(title);
    expect(html).not.toContain('No product analysis activity');
  });

  it('keeps the loaded events and says so when a refresh fails', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      feed(LATEST_EVENTS, LATEST_EVENTS.length, { isError: true, error: { status: 500 } }),
    );

    const html = render();

    expect(html).toContain('The feed could not be refreshed');
    expect(html).toContain('Review price today-late');
    expect(html).not.toContain('Something went wrong');
  });

  it('shows a failed refresh only over the events of the current filter set', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      feed([], 0, { isError: true, error: { status: 500 } }),
    );

    const html = render();

    expect(html).toContain('Something went wrong');
    expect(html).not.toContain('The feed could not be refreshed');
  });

  it('offers a retry when the feed cannot be loaded', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      query(undefined, { isLoading: false, isError: true, error: { status: 500 }, hasNextPage: false }),
    );

    const html = render();

    expect(html).toContain('Something went wrong');
    expect(html).toContain('Try again');
  });
});

// Regression guards: RTK Query keeps the previous arguments' result in `data`, so a page that
// reads `data` shows the old tab's cards while the new tab loads, fails or is not requested.
describe('Hermes feed after the filters change', () => {
  it('regression guard: shows skeleton cards, not the previous tab, while the new filter set loads', () => {
    mockUseHermesEventFeed.mockImplementation(() => afterFilterChange({ isFetching: true }));

    const html = render({ initialTab: 'alerts' });

    expect(html).toContain('MuiSkeleton');
    expect(html).not.toContain('Review price');
    expect(html).not.toContain('The feed could not be refreshed');
  });

  it('regression guard: shows the error state, not the previous tab under a false warning, when the new request fails', () => {
    mockUseHermesEventFeed.mockImplementation(() =>
      afterFilterChange({ isError: true, error: { status: 500 } }),
    );

    const html = render({ initialTab: 'alerts' });

    expect(html).toContain('Something went wrong');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Review price');
    expect(html).not.toContain('These events are what was loaded before');
    expect(html).not.toContain('MuiSkeleton');
  });

  it('regression guard: shows the filters empty state and no rows when the tab and the selects match nothing', () => {
    mockUseHermesEventFeed.mockImplementation(() => afterFilterChange({ isUninitialized: true }));

    const html = render({ initialTab: 'completed', initialStatusFilter: ['pending_review'] });

    expect(mockUseHermesEventFeed).toHaveBeenLastCalledWith(null);
    expect(html).toContain('No events match these filters');
    expect(html).not.toContain('Review price');
    expect(html).not.toContain('MuiSkeleton');
    expect(html).not.toContain('Something went wrong');
  });

  it('passes select filters that fit the tab through to the server', () => {
    render({ initialTab: 'completed', initialStatusFilter: ['applied'], initialSeverityFilter: ['success'] });

    expect(mockUseHermesEventFeed).toHaveBeenLastCalledWith({
      status: ['applied'],
      severity: ['success'],
      sort: '-createdAt',
    });
  });
});
