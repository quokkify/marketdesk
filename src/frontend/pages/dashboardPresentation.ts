import type { HermesEvent, HermesSeverity, Listing, Marketplace, Product } from '@shared/types';
import type { AnalyticsOverview, AnalyticsQueryParams } from '../state/api/index.js';
import { formatMoney, formatNumber } from '../utils/formatters.js';
import { hermesTypeLabel, isSeoRecommendation } from '../utils/labels.js';

export const DASHBOARD_EVENT_LIMIT = 8;
export const DASHBOARD_SECTION_LIMIT = 4;
export const DASHBOARD_ATTENTION_LIMIT = 5;
// The listings endpoint has no status filter, so the dashboard reads the same page the Listings
// screen loads (one shared cache entry) and keeps the expired rows client-side.
export const DASHBOARD_LISTING_SCAN_LIMIT = 100;
// The overview compares the requested 30-day range with the equal-length window right before it.
export const DASHBOARD_DELTA_LABEL = 'vs previous 30 days';

const UNKNOWN_VALUE = '—';

const ACTIVE_HERMES_STATUSES = new Set<HermesEvent['status']>(['applying', 'reverting']);

export const DASHBOARD_QUICK_ACTIONS = [
  { key: 'add', label: 'Add product', kind: 'route', path: '/products?newProduct=1' },
  { key: 'sync', label: 'Sync all', kind: 'sync-all' },
  { key: 'analyze', label: 'Analyze a product', kind: 'route', path: '/products' },
  { key: 'analytics', label: 'View analytics', kind: 'route', path: '/analytics' },
] as const;

export type DashboardTone = 'primary' | 'success' | 'info' | 'warning' | 'error';

export function dashboardRevenueRange(now = new Date()): AnalyticsQueryParams {
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    interval: 'day',
  };
}

export interface MarketplacePresentation {
  statusLabel: 'Connected' | 'Needs attention' | 'Not connected';
  statusColor: 'success' | 'warning' | 'default';
}

export function marketplacePresentation(marketplace: Marketplace): MarketplacePresentation {
  if (!marketplace.connected) return { statusLabel: 'Not connected', statusColor: 'default' };
  if (marketplace.errorCount > 0) {
    return { statusLabel: 'Needs attention', statusColor: 'warning' };
  }
  return { statusLabel: 'Connected', statusColor: 'success' };
}

export function marketplaceOperationalSummary(marketplace: Marketplace): string {
  const segments = [`${marketplace.syncMode} sync`];
  if (marketplace.errorCount > 0) segments.push(`${marketplace.errorCount} errors`);
  return segments.join(' · ');
}

export function isSandboxMarketplace(marketplace: Marketplace): boolean {
  // The sandbox flag arrives with the OLX sandbox work; read it defensively until the shared
  // Marketplace type carries it everywhere.
  return (marketplace as Marketplace & { sandbox?: boolean }).sandbox === true;
}

export function marketplaceDisplayName(marketplace: Marketplace): string {
  return isSandboxMarketplace(marketplace) ? `${marketplace.name} (Sandbox)` : marketplace.name;
}

export function isHermesRunActive(events: readonly HermesEvent[]): boolean {
  return events.some((event) => ACTIVE_HERMES_STATUSES.has(event.status));
}

export function shouldShowHermesRunning(
  events: readonly HermesEvent[],
  state: { isLoading: boolean; isError: boolean }
): boolean {
  return !state.isLoading && !state.isError && isHermesRunActive(events);
}

export function splitDashboardEvents(events: readonly HermesEvent[]): {
  latest: HermesEvent[];
  timeline: HermesEvent[];
} {
  return {
    latest: events.slice(0, DASHBOARD_SECTION_LIMIT),
    timeline: events.slice(DASHBOARD_SECTION_LIMIT, DASHBOARD_EVENT_LIMIT),
  };
}

export function dashboardActivityEvents(events: readonly HermesEvent[]): HermesEvent[] {
  return events.filter(
    (event) => !(event.status === 'pending_review' && isSeoRecommendation(event))
  );
}

const SEVERITY_TONES: Record<HermesSeverity, Exclude<DashboardTone, 'primary'>> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  critical: 'error',
};

export function hermesSeverityTone(severity: HermesSeverity): Exclude<DashboardTone, 'primary'> {
  return SEVERITY_TONES[severity];
}

// Hermes runs are started by the seller (per product); nothing here may suggest background work.
export const HERMES_ACTIVITY_SUBTITLE = 'Latest suggestions and alerts from Hermes';

export interface DashboardEmptyState {
  title: string;
  description: string;
  action: { label: string; path: string };
}

export function hermesActivityEmptyState(hasConnectedMarketplace: boolean): DashboardEmptyState {
  if (!hasConnectedMarketplace) {
    return {
      title: 'Connect a marketplace to start',
      description:
        'Connect OLX and publish a product, then analyze it with Hermes to see suggestions here.',
      action: { label: 'Connect marketplace', path: '/marketplaces' },
    };
  }
  return {
    title: 'No Hermes activity yet',
    description: 'Suggestions appear here after you analyze a product with Hermes.',
    action: { label: 'Analyze a product', path: '/products' },
  };
}

// ---- KPI row ---------------------------------------------------------------------------------

export interface DashboardKpi {
  key: 'revenue' | 'profit' | 'activeListings' | 'attention';
  label: string;
  value: string;
  caption?: string;
  deltaPct?: number;
  tone: DashboardTone;
}

export interface DashboardKpiInput {
  // Undefined while the overview is loading or failed; every value then reads as unknown.
  overview: AnalyticsOverview | undefined;
  // Total pending critical Hermes events; undefined while that query is loading or failed.
  criticalPendingTotal: number | undefined;
  // Workspace currency, used when the overview carries none (no sales yet) and for inventory.
  currency: string;
}

// Change relative to the size of the previous value, so a swing out of a loss reads as growth.
function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | undefined {
  if (typeof current !== 'number' || typeof previous !== 'number') return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined;
  return ((current - previous) * 100) / Math.abs(previous);
}

// Only the period fields `previous` really carries, and only when both periods share a currency.
function periodDelta(overview: AnalyticsOverview, field: 'revenue' | 'profit'): number | undefined {
  const { previous } = overview;
  if (!previous || previous.currency !== overview.currency) return undefined;
  return percentChange(overview[field], previous[field]);
}

export function attentionCount(
  overview: AnalyticsOverview | undefined,
  criticalPendingTotal: number | undefined
): number | undefined {
  if (!overview || criticalPendingTotal === undefined) return undefined;
  return (
    overview.productsByStatus.attention + overview.listingsByStatus.expired + criticalPendingTotal
  );
}

export function dashboardKpis({
  overview,
  criticalPendingTotal,
  currency,
}: DashboardKpiInput): DashboardKpi[] {
  const periodCurrency = overview?.currency ?? currency;
  return [
    {
      key: 'revenue',
      label: 'Revenue',
      value: overview ? formatMoney(overview.revenue, periodCurrency) : UNKNOWN_VALUE,
      caption: overview
        ? `Inventory value ${formatMoney(overview.inventoryValue, currency)}`
        : undefined,
      deltaPct: overview ? periodDelta(overview, 'revenue') : undefined,
      tone: 'primary',
    },
    {
      key: 'profit',
      label: 'Profit',
      value: overview ? formatMoney(overview.profit, periodCurrency) : UNKNOWN_VALUE,
      deltaPct: overview ? periodDelta(overview, 'profit') : undefined,
      tone: 'success',
    },
    {
      key: 'activeListings',
      label: 'Active listings',
      value: formatNumber(overview?.liveListingCount),
      tone: 'info',
    },
    {
      key: 'attention',
      label: 'Needs attention',
      value: formatNumber(attentionCount(overview, criticalPendingTotal)),
      tone: 'warning',
    },
  ];
}

export function salesChartSummary(
  overview: AnalyticsOverview | undefined,
  currency: string
): string {
  const prefix = 'Revenue and profit over the last 30 days:';
  if (!overview) return `${prefix} totals are unavailable.`;
  const periodCurrency = overview.currency ?? currency;
  const part = (label: string, amount: number | null) =>
    amount === null ? `${label} unavailable` : `${label} ${formatMoney(amount, periodCurrency)}`;
  return `${prefix} ${part('revenue', overview.revenue)}, ${part('profit', overview.profit)}.`;
}

// ---- Needs attention -------------------------------------------------------------------------

export const DASHBOARD_ATTENTION_EMPTY = {
  title: 'All clear',
  description: 'No products, listings or critical Hermes alerts need attention.',
} as const;

export interface AttentionItem {
  key: string;
  title: string;
  reason: string;
  severity: 'critical' | 'warning';
  path: string;
}

export interface AttentionItemsInput {
  // Pending critical Hermes events, already filtered by the server.
  criticalEvents: readonly HermesEvent[];
  // An unfiltered listing page; only the expired rows are used.
  listings: readonly Listing[];
  // Products whose status is `attention`, already filtered by the server.
  attentionProducts: readonly Product[];
  limit?: number;
}

function productPath(productId: string): string {
  return `/products/${encodeURIComponent(productId)}`;
}

// Critical alerts first, then expired listings, then products awaiting review; each source keeps
// the order the server returned it in.
export function attentionItems({
  criticalEvents,
  listings,
  attentionProducts,
  limit = DASHBOARD_ATTENTION_LIMIT,
}: AttentionItemsInput): AttentionItem[] {
  const fromEvents = criticalEvents.map((event): AttentionItem => ({
    key: `event:${event.id}`,
    title: event.title,
    reason: event.detail?.trim() || hermesTypeLabel(event.type),
    severity: 'critical',
    path: event.productId ? productPath(event.productId) : '/hermes',
  }));
  const fromListings = listings
    .filter((listing) => listing.status === 'expired')
    .map((listing): AttentionItem => ({
      key: `listing:${listing.id}`,
      title: listing.productName ?? listing.productSku ?? 'Untitled listing',
      reason: 'Listing expired',
      severity: 'warning',
      path: productPath(listing.productId),
    }));
  const fromProducts = attentionProducts.map((product): AttentionItem => ({
    key: `product:${product.id}`,
    title: product.name,
    reason: 'Product requires review',
    severity: 'warning',
    path: productPath(product.id),
  }));
  return [...fromEvents, ...fromListings, ...fromProducts].slice(0, limit);
}

export function attentionOverflowLabel(
  total: number | undefined,
  shown: number
): string | undefined {
  if (total === undefined || total <= shown) return undefined;
  const rest = total - shown;
  const phrase = `${rest === 1 ? 'item needs' : 'items need'} attention`;
  return shown === 0 ? `${rest} ${phrase}` : `${rest} more ${phrase}`;
}

export function attentionBadgeLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

// ---- Sync all --------------------------------------------------------------------------------

export interface SyncAllPlan {
  targets: Marketplace[];
  disabledReason?: string;
}

// Marketplaces are `undefined` while their query is loading or failed.
export function planSyncAll(marketplaces: readonly Marketplace[] | undefined): SyncAllPlan {
  if (!marketplaces) return { targets: [], disabledReason: 'Marketplaces are not loaded yet' };
  const targets = marketplaces.filter((marketplace) => marketplace.connected);
  return targets.length > 0
    ? { targets }
    : { targets, disabledReason: 'Connect a marketplace first' };
}

export interface SyncAllOutcome {
  marketplace: Marketplace;
  // Set when the sync request was rejected; absent when it was accepted.
  error?: string;
}

export interface DashboardToast {
  message: string;
  severity: 'success' | 'warning' | 'error';
}

export function syncAllToast(outcomes: readonly SyncAllOutcome[]): DashboardToast {
  if (outcomes.length === 0) {
    return { message: 'No connected marketplaces to sync.', severity: 'warning' };
  }
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  const started = outcomes.length - failed.length;
  const only = outcomes.length === 1 ? marketplaceDisplayName(outcomes[0].marketplace) : undefined;

  if (failed.length === 0) {
    return {
      message: only ? `${only} sync started.` : `Sync started for ${outcomes.length} marketplaces.`,
      severity: 'success',
    };
  }
  if (started === 0) {
    return {
      message: only
        ? `${only} sync failed: ${failed[0].error}`
        : `Sync failed for ${outcomes.length} marketplaces: ${failed[0].error}`,
      severity: 'error',
    };
  }
  const names = failed.map((outcome) => marketplaceDisplayName(outcome.marketplace)).join(', ');
  return {
    message: `Sync started for ${started} of ${outcomes.length} marketplaces. Failed: ${names}.`,
    severity: 'warning',
  };
}
