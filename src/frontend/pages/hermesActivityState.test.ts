import type { HermesEvent, HermesStatusView, Marketplace } from '@shared/types';
import {
  HERMES_OFFLINE_TOOLTIP,
  buildHermesMetrics,
  countEventsSince,
  flattenHermesFeed,
  hermesEmptyState,
  hermesFeedFilters,
  hermesStatusChip,
  hermesWatching,
  startOfLocalDay,
} from './hermesActivityState';

const event = (id: string, createdAt: Date): HermesEvent =>
  ({ id, createdAt: createdAt.toISOString() }) as HermesEvent;

describe('hermesFeedFilters', () => {
  it('maps each tab to the multi-value server parameters, newest first', () => {
    expect(hermesFeedFilters('all', [], [])).toEqual({ sort: '-createdAt' });
    expect(hermesFeedFilters('suggestions', [], [])).toEqual({
      status: ['pending_decision', 'pending_review'],
      sort: '-createdAt',
    });
    expect(hermesFeedFilters('alerts', [], [])).toEqual({
      severity: ['warning', 'critical'],
      sort: '-createdAt',
    });
    expect(hermesFeedFilters('completed', [], [])).toEqual({
      status: ['applied', 'dismissed', 'reverted'],
      sort: '-createdAt',
    });
  });

  it('passes the status and severity selects through on the All tab', () => {
    expect(hermesFeedFilters('all', ['failed'], ['info', 'success'])).toEqual({
      status: ['failed'],
      severity: ['info', 'success'],
      sort: '-createdAt',
    });
  });

  it('narrows the tab with the selects instead of widening it', () => {
    expect(hermesFeedFilters('completed', ['applied', 'pending_review'], [])).toEqual({
      status: ['applied'],
      sort: '-createdAt',
    });
    expect(hermesFeedFilters('alerts', [], ['critical', 'info'])).toEqual({
      severity: ['critical'],
      sort: '-createdAt',
    });
    expect(hermesFeedFilters('suggestions', [], ['critical'])).toEqual({
      status: ['pending_decision', 'pending_review'],
      severity: ['critical'],
      sort: '-createdAt',
    });
  });

  it('returns null when the tab and the selects can match no event', () => {
    expect(hermesFeedFilters('completed', ['pending_review'], [])).toBeNull();
    expect(hermesFeedFilters('alerts', [], ['info'])).toBeNull();
  });
});

describe('flattenHermesFeed', () => {
  const page = (ids: string[], total: number) => ({
    items: ids.map((id) => ({ id }) as HermesEvent),
    total,
  });

  it('joins the loaded pages in order and reports the latest pagination total', () => {
    const { items, total } = flattenHermesFeed({ pages: [page(['a', 'b'], 5), page(['c'], 4)] });

    expect(items.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(total).toBe(4);
  });

  it('keeps an event once when consecutive page fetches overlap', () => {
    const { items } = flattenHermesFeed({ pages: [page(['a', 'b'], 3), page(['b', 'c'], 3)] });

    expect(items.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty before anything was loaded', () => {
    expect(flattenHermesFeed(undefined)).toEqual({ items: [], total: 0 });
  });
});

describe('events created since local midnight', () => {
  const now = new Date(2026, 9, 24, 15, 30);

  it('starts the day at local 00:00', () => {
    expect(startOfLocalDay(now)).toEqual(new Date(2026, 9, 24, 0, 0, 0, 0));
  });

  it('counts events from midnight on, and not the last minute of yesterday', () => {
    const events = [
      event('now', now),
      event('midnight', new Date(2026, 9, 24, 0, 0)),
      event('yesterday', new Date(2026, 9, 23, 23, 59)),
      event('older', new Date(2026, 9, 1, 12, 0)),
    ];

    expect(countEventsSince(events, startOfLocalDay(now))).toBe(2);
  });

  it('ignores events whose timestamp cannot be read', () => {
    expect(
      countEventsSince([{ createdAt: 'not a date' } as HermesEvent], startOfLocalDay(now)),
    ).toBe(0);
  });
});

describe('hermesStatusChip', () => {
  const status = (overrides: Partial<HermesStatusView>): HermesStatusView => ({
    mode: 'auto',
    activeProvider: 'offline',
    hermesConfigured: false,
    hermesReachable: null,
    checkedAt: '2026-10-24T10:00:00.000Z',
    ...overrides,
  });
  const ready = { isLoading: false, isError: false };

  it('says Hermes is connected only when Hermes answers and is the active provider', () => {
    expect(
      hermesStatusChip(
        status({ activeProvider: 'hermes', hermesConfigured: true, hermesReachable: true }),
        ready,
      ),
    ).toEqual({ label: 'Hermes connected', color: 'success' });
  });

  it('labels the built-in heuristics honestly with the review-only tooltip', () => {
    expect(hermesStatusChip(status({}), ready)).toEqual({
      label: 'Offline heuristics',
      color: 'warning',
      tooltip: HERMES_OFFLINE_TOOLTIP,
    });
    expect(HERMES_OFFLINE_TOOLTIP).toBe(
      'Hermes Agent API is not reachable; suggestions come from built-in heuristics and always wait for your review',
    );
  });

  it('does not blame reachability when offline mode was chosen on purpose', () => {
    const chip = hermesStatusChip(status({ mode: 'offline' }), ready);

    expect(chip.label).toBe('Offline heuristics');
    expect(chip.tooltip).toContain('switched off');
    expect(chip.tooltip).toContain('built-in heuristics and always wait for your review');
    expect(chip.tooltip).not.toContain('not reachable');
  });

  it('does not claim a connection when Hermes is forced on but does not answer', () => {
    expect(
      hermesStatusChip(
        status({ mode: 'hermes', activeProvider: 'hermes', hermesConfigured: true, hermesReachable: false }),
        ready,
      ),
    ).toMatchObject({ label: 'Hermes unavailable', color: 'error' });
    expect(
      hermesStatusChip(status({ mode: 'hermes', activeProvider: 'hermes' }), ready).label,
    ).toBe('Hermes unavailable');
  });

  it('is neutral while the status loads or cannot be read', () => {
    expect(hermesStatusChip(undefined, { isLoading: true, isError: false })).toEqual({
      label: 'Checking Hermes…',
      color: 'default',
    });
    expect(hermesStatusChip(undefined, { isLoading: false, isError: true })).toMatchObject({
      label: 'Status unavailable',
      color: 'default',
    });
  });
});

describe('hermesWatching', () => {
  const marketplace = (overrides: Partial<Marketplace>): Marketplace =>
    ({ id: 'm', key: 'olx', connected: true, sandbox: false, ...overrides }) as Marketplace;
  const ready = <T,>(data: T) => ({ data, isLoading: false, isError: false });

  it('counts live listings and only the connected marketplaces', () => {
    expect(
      hermesWatching(ready({ liveListingCount: 12 }), ready([
        marketplace({ id: 'a' }),
        marketplace({ id: 'b', key: 'allegro', connected: false }),
      ])),
    ).toEqual({ kind: 'ready', sentence: 'Watching 12 live listings on 1 marketplace', sandbox: false });
  });

  it('uses singular and plural nouns', () => {
    expect(
      hermesWatching(ready({ liveListingCount: 1 }), ready([])),
    ).toMatchObject({ sentence: 'Watching 1 live listing on 0 marketplaces' });
  });

  it('flags sandbox only while a connected marketplace is a sandbox', () => {
    expect(
      hermesWatching(ready({ liveListingCount: 3 }), ready([marketplace({ sandbox: true })])),
    ).toMatchObject({ sandbox: true });
    expect(
      hermesWatching(
        ready({ liveListingCount: 3 }),
        ready([marketplace({ sandbox: true, connected: false })]),
      ),
    ).toMatchObject({ sandbox: false });
  });

  it('is loading until both counts are known and unavailable when either failed', () => {
    expect(
      hermesWatching({ isLoading: true, isError: false }, ready([])),
    ).toEqual({ kind: 'loading' });
    expect(
      hermesWatching(ready({ liveListingCount: 3 }), { isLoading: false, isError: true }),
    ).toEqual({ kind: 'unavailable' });
  });
});

describe('buildHermesMetrics', () => {
  const now = new Date(2026, 9, 24, 15, 30);
  const totals = (total: number) => ({ data: { total }, isLoading: false, isError: false });
  const recent = (events: HermesEvent[]) => ({
    data: { items: events, total: events.length },
    isLoading: false,
    isError: false,
  });

  it('lists the four honest tiles in order', () => {
    const metrics = buildHermesMetrics({
      awaitingReview: totals(3),
      completed: totals(31),
      dismissed: totals(5),
      recent: recent([]),
      now,
    });

    expect(metrics.map((m) => m.label)).toEqual([
      'Actions today',
      'Awaiting review',
      'Completed',
      'Dismissed',
    ]);
    expect(metrics.map((m) => m.value)).toEqual(['0', '3', '31', '5']);
  });

  it('counts today among the loaded events and says how many were loaded', () => {
    const metrics = buildHermesMetrics({
      awaitingReview: totals(0),
      completed: totals(0),
      dismissed: totals(0),
      recent: recent([
        event('a', new Date(2026, 9, 24, 14, 0)),
        event('b', new Date(2026, 9, 24, 9, 0)),
        event('c', new Date(2026, 9, 23, 22, 0)),
        event('d', new Date(2026, 9, 20, 8, 0)),
      ]),
      now,
    });

    expect(metrics[0]).toMatchObject({ label: 'Actions today', value: '2', caption: 'of the latest 4 loaded' });
  });

  it('says so when no event has been recorded instead of implying a sample', () => {
    const [actions] = buildHermesMetrics({
      awaitingReview: totals(0),
      completed: totals(0),
      dismissed: totals(0),
      recent: recent([]),
      now,
    });

    expect(actions).toMatchObject({ value: '0', caption: 'No events recorded yet' });
  });

  it('shows a skeleton while loading and a dash with a reason when a count failed', () => {
    const metrics = buildHermesMetrics({
      awaitingReview: { isLoading: true, isError: false },
      completed: { isLoading: false, isError: true },
      dismissed: totals(5),
      recent: { isLoading: false, isError: true },
      now,
    });

    expect(metrics[0]).toMatchObject({ value: '—', caption: 'Could not be loaded' });
    expect(metrics[1]).toMatchObject({ label: 'Awaiting review', value: null });
    expect(metrics[2]).toMatchObject({ value: '—', caption: 'Could not be loaded' });
    expect(metrics[3]).toMatchObject({ value: '5' });
  });

  it('never presents a metric as unavailable by design', () => {
    const metrics = buildHermesMetrics({
      awaitingReview: totals(1),
      completed: totals(1),
      dismissed: totals(1),
      recent: recent([]),
      now,
    });

    expect(JSON.stringify(metrics)).not.toContain('Unavailable');
  });
});

describe('hermesEmptyState', () => {
  it('names what each empty tab is waiting for', () => {
    expect(hermesEmptyState('all', false).title).toBe('No product analysis activity');
    expect(hermesEmptyState('suggestions', false).title).toBe('No suggestions to review');
    expect(hermesEmptyState('alerts', false).title).toBe('No alerts');
    expect(hermesEmptyState('completed', false).title).toBe('Nothing completed yet');
  });

  it('blames the filters, not the feed, while status or severity selects are in use', () => {
    for (const tab of ['all', 'suggestions', 'alerts', 'completed'] as const) {
      expect(hermesEmptyState(tab, true)).toEqual({
        title: 'No events match these filters',
        description: 'Clear the status and severity filters, or switch tabs, to see more activity.',
      });
    }
  });
});
