// Pure logic of the Hermes activity page: tab-to-server filters, feed flattening,
// the stat tiles and the provider status chip. No hooks and no React, so every
// rule here is unit-testable.
import type {
  HermesEvent,
  HermesEventStatus,
  HermesSeverity,
  HermesStatusView,
  Marketplace,
} from '@shared/types';
import type { HermesEventFeedParams } from '../state/api/index.js';

export type HermesActivityTab = 'all' | 'suggestions' | 'alerts' | 'completed';

export const HERMES_ACTIVITY_TABS: ReadonlyArray<{ value: HermesActivityTab; label: string }> = [
  { value: 'all', label: 'All activity' },
  { value: 'suggestions', label: 'Suggestions' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'completed', label: 'Completed' },
];

interface TabFilters {
  status?: readonly HermesEventStatus[];
  severity?: readonly HermesSeverity[];
}

// What each tab asks of the server. Statuses and severities are multi-value filters.
const TAB_FILTERS: Record<HermesActivityTab, TabFilters> = {
  all: {},
  suggestions: { status: ['pending_decision', 'pending_review'] },
  alerts: { severity: ['warning', 'critical'] },
  completed: { status: ['applied', 'dismissed', 'reverted'] },
};

// A tab fixes some dimensions and the selects can only narrow them. `undefined`
// leaves the dimension open; `null` means tab and selects share no value.
function narrow<T extends string>(
  fromTab: readonly T[] | undefined,
  selected: readonly T[],
): T[] | null | undefined {
  if (!fromTab) return selected.length > 0 ? [...selected] : undefined;
  if (selected.length === 0) return [...fromTab];
  const shared = fromTab.filter((value) => selected.includes(value));
  return shared.length > 0 ? shared : null;
}

// Server-side feed filters for a tab plus the status and severity selects; null when
// the combination can match no event, so the caller fetches nothing.
export function hermesFeedFilters(
  tab: HermesActivityTab,
  selectedStatuses: readonly HermesEventStatus[],
  selectedSeverities: readonly HermesSeverity[],
): HermesEventFeedParams | null {
  const status = narrow(TAB_FILTERS[tab].status, selectedStatuses);
  const severity = narrow(TAB_FILTERS[tab].severity, selectedSeverities);
  if (status === null || severity === null) return null;
  return {
    ...(status && { status }),
    ...(severity && { severity }),
    sort: '-createdAt',
  };
}

// The product page's analyze button names the provider that answers (Hermes or the offline
// heuristics), so these point at it as "Analyze" and name no provider.
const EMPTY_STATES: Record<HermesActivityTab, { title: string; description: string }> = {
  all: {
    title: 'No product analysis activity',
    description:
      'Open a product and use Analyze, or change filters to see recorded suggestions, alerts, and completed actions.',
  },
  suggestions: {
    title: 'No suggestions to review',
    description: 'Suggestions appear here after you open a product and use Analyze.',
  },
  alerts: {
    title: 'No alerts',
    description: 'Warnings and critical findings from product analysis appear here.',
  },
  completed: {
    title: 'Nothing completed yet',
    description: 'Applied, dismissed and reverted suggestions appear here.',
  },
};

// Empty-feed copy for a tab. With the status or severity selects in use, the likelier
// reason for an empty list is the filters, so the copy says that instead.
export function hermesEmptyState(
  tab: HermesActivityTab,
  filtersActive: boolean,
): { title: string; description: string } {
  return filtersActive
    ? {
        title: 'No events match these filters',
        description: 'Clear the status and severity filters, or switch tabs, to see more activity.',
      }
    : EMPTY_STATES[tab];
}

interface FeedPages {
  pages: ReadonlyArray<{ items: readonly HermesEvent[]; total: number }>;
}

// The loaded pages as one list and the latest pagination.total. An event that two
// page fetches both returned (the feed moved between them) is listed once.
export function flattenHermesFeed(data: FeedPages | undefined): {
  items: HermesEvent[];
  total: number;
} {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const items: HermesEvent[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return { items, total: pages[pages.length - 1]?.total ?? 0 };
}

export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function countEventsSince(
  events: readonly Pick<HermesEvent, 'createdAt'>[],
  since: Date,
): number {
  return events.filter((event) => new Date(event.createdAt).getTime() >= since.getTime()).length;
}

// The part of an RTK Query hook result these rules read. The index signature keeps the
// type from being "weak", so the hook wrappers whose results are loosely typed still fit.
interface QueryState {
  isLoading?: boolean;
  isError?: boolean;
  [field: string]: unknown;
}
type QueryOf<T> = QueryState & { data?: T };

export interface HermesStatusChip {
  label: string;
  color: 'success' | 'warning' | 'error' | 'default';
  tooltip?: string;
}

export const HERMES_OFFLINE_TOOLTIP =
  'Hermes Agent API is not reachable; suggestions come from built-in heuristics and always wait for your review';
const HERMES_SWITCHED_OFF_TOOLTIP =
  'Hermes is switched off for this deployment; suggestions come from built-in heuristics and always wait for your review';
const HERMES_DOWN_TOOLTIP =
  'Hermes is selected for this deployment but its API is not configured or did not answer; AI requests fail until it responds';

// What the banner may claim about the AI provider. "Connected" needs Hermes to be the
// active provider and to have answered its health check; a deployment that forces
// Hermes on while it is down must not read as connected.
export function hermesStatusChip(
  status: HermesStatusView | undefined,
  { isError }: QueryState,
): HermesStatusChip {
  if (!status) {
    return isError
      ? { label: 'Status unavailable', color: 'default', tooltip: 'The Hermes status could not be loaded' }
      : { label: 'Checking Hermes…', color: 'default' };
  }
  if (status.activeProvider === 'offline') {
    return {
      label: 'Offline heuristics',
      color: 'warning',
      tooltip: status.mode === 'offline' ? HERMES_SWITCHED_OFF_TOOLTIP : HERMES_OFFLINE_TOOLTIP,
    };
  }
  if (status.hermesReachable === true) return { label: 'Hermes connected', color: 'success' };
  return { label: 'Hermes unavailable', color: 'error', tooltip: HERMES_DOWN_TOOLTIP };
}

export type HermesWatching =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; sentence: string; sandbox: boolean };

const countOf = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

// The banner sentence from the live listing count and the connected marketplaces.
// Nothing schedules Hermes in this build, so the sentence says when it runs instead
// of claiming it watches the listings.
export function hermesWatching(
  overview: QueryOf<{ liveListingCount: number }>,
  marketplaces: QueryOf<ReadonlyArray<Pick<Marketplace, 'connected' | 'sandbox'>>>,
): HermesWatching {
  if (overview.isError || marketplaces.isError) return { kind: 'unavailable' };
  if (overview.data === undefined || marketplaces.data === undefined) return { kind: 'loading' };
  const connected = marketplaces.data.filter((marketplace) => marketplace.connected);
  return {
    kind: 'ready',
    sentence: `${countOf(overview.data.liveListingCount, 'live listing')} on ${countOf(connected.length, 'marketplace')} · Hermes runs when you analyze a product`,
    sandbox: connected.some((marketplace) => marketplace.sandbox),
  };
}

export interface HermesMetric {
  label: string;
  /** null while the number is still loading. */
  value: string | null;
  caption: string;
}

// The newest events fetched to count today's actions; the API has no day-scoped aggregate.
export const HERMES_ACTIONS_SAMPLE_SIZE = 50;

const UNKNOWN_VALUE = '—';
const UNKNOWN_CAPTION = 'Could not be loaded';

function totalMetric(label: string, caption: string, query: QueryOf<{ total: number }>): HermesMetric {
  if (query.isError) return { label, value: UNKNOWN_VALUE, caption: UNKNOWN_CAPTION };
  if (query.data === undefined) return { label, value: null, caption };
  return { label, value: String(query.data.total), caption };
}

function actionsTodayMetric(
  recent: QueryOf<{ items: readonly HermesEvent[] }>,
  now: Date,
): HermesMetric {
  const label = 'Actions today';
  if (recent.isError) return { label, value: UNKNOWN_VALUE, caption: UNKNOWN_CAPTION };
  if (recent.data === undefined) return { label, value: null, caption: '' };
  const { items } = recent.data;
  if (items.length === 0) return { label, value: '0', caption: 'No events recorded yet' };
  return {
    label,
    value: String(countEventsSince(items, startOfLocalDay(now))),
    caption: `of the latest ${items.length} loaded`,
  };
}

// Stat tiles built only from list queries the API really answers. Actions today counts
// the loaded events created since local midnight and says how many were loaded, so
// the number is never read as a full-day total.
export function buildHermesMetrics(input: {
  awaitingReview: QueryOf<{ total: number }>;
  completed: QueryOf<{ total: number }>;
  dismissed: QueryOf<{ total: number }>;
  recent: QueryOf<{ items: readonly HermesEvent[] }>;
  now: Date;
}): HermesMetric[] {
  return [
    actionsTodayMetric(input.recent, input.now),
    totalMetric('Awaiting review', 'waiting for your decision', input.awaitingReview),
    totalMetric('Completed', 'applied, all time', input.completed),
    totalMetric('Dismissed', 'dismissed, all time', input.dismissed),
  ];
}
