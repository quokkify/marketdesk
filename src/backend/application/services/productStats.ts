// Per-product view statistics and "needs action" reasons for the products catalogue.
// Pure functions: the service gathers listings, view events and awaiting counts, these decide.
import type { ListingStatus, NeedsActionReason, ProductStats, ProductStatus } from '@shared/types';

export const STATS_DAYS = 14;
export const GROWTH_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const STALE_AFTER_MS = 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export interface ViewEventInput {
  id: string;
  listingId: string | null;
  eventType: string;
  quantity: number;
  occurredAt: Date;
}

export interface ListingViews {
  delta7d: number;
  byDay: number[];
}

export interface StatsListing {
  productId: string;
  status: ListingStatus;
  views: number | null;
  watchers: number | null;
  messages: number | null;
  lastSyncAt: Date | null;
  publishedAt: Date | null;
  externalUrl: string | null;
}

export type ProductStatsSummary = Omit<ProductStats, 'needsAction'> & {
  oldestLivePublishedAt: Date | null;
};

const STATUS_SEVERITY: Record<ListingStatus, number> = { live: 0, draft: 1, expired: 2, error: 3 };

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// The earliest view event of a listing holds its whole pre-tracking total, so it is never growth.
export function summarizeListingViews(
  events: ReadonlyArray<ViewEventInput>,
  baselineIds: ReadonlySet<string>,
  now: Date
): Map<string, ListingViews> {
  const result = new Map<string, ListingViews>();
  const today = startOfUtcDay(now);
  const growthFrom = now.getTime() - GROWTH_WINDOW_MS;
  for (const event of events) {
    if (event.eventType !== 'view' || !event.listingId || baselineIds.has(event.id)) continue;
    const entry = result.get(event.listingId) ?? {
      delta7d: 0,
      byDay: Array<number>(STATS_DAYS).fill(0),
    };
    const at = event.occurredAt.getTime();
    if (at >= growthFrom && at <= now.getTime()) entry.delta7d += event.quantity;
    const index = STATS_DAYS - 1 - Math.floor((today - startOfUtcDay(event.occurredAt)) / DAY_MS);
    if (index >= 0 && index < STATS_DAYS) entry.byDay[index]! += event.quantity;
    result.set(event.listingId, entry);
  }
  return result;
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

export function summarizeProduct(
  listings: readonly StatsListing[],
  views: Map<string, ListingViews>,
  listingIds: readonly string[],
  now: Date
): ProductStatsSummary {
  const lastSync = listings
    .map((listing) => listing.lastSyncAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const stale = !lastSync || now.getTime() - lastSync.getTime() > STALE_AFTER_MS;
  const byDay = Array<number>(STATS_DAYS).fill(0);
  let delta = 0;
  listingIds.forEach((id) => {
    const listingViews = views.get(id);
    if (!listingViews) return;
    delta += listingViews.delta7d;
    listingViews.byDay.forEach((count, index) => {
      byDay[index]! += count;
    });
  });
  const worst = listings.reduce<ListingStatus | null>(
    (current, listing) =>
      current === null || STATUS_SEVERITY[listing.status] > STATUS_SEVERITY[current]
        ? listing.status
        : current,
    null
  );
  const liveListing = listings.find((listing) => listing.status === 'live' && listing.externalUrl);
  const latestWithUrl = [...listings]
    .filter((listing) => listing.externalUrl)
    .sort((a, b) => (b.lastSyncAt?.getTime() ?? 0) - (a.lastSyncAt?.getTime() ?? 0))[0];
  const livePublished = listings
    .filter((listing) => listing.status === 'live' && listing.publishedAt)
    .map((listing) => listing.publishedAt!)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    views: sumNullable(listings.map((listing) => listing.views)),
    watchers: sumNullable(listings.map((listing) => listing.watchers)),
    messages: sumNullable(listings.map((listing) => listing.messages)),
    viewsDelta7d: stale ? null : delta,
    viewsByDay: byDay,
    lastSyncAt: lastSync ? lastSync.toISOString() : null,
    stale,
    externalUrl: (liveListing ?? latestWithUrl)?.externalUrl ?? null,
    listingStatus: worst,
    oldestLivePublishedAt: livePublished ?? null,
  };
}

export function needsActionReasons(input: {
  productStatus: ProductStatus;
  awaiting: number;
  stats: ProductStatsSummary | undefined;
  now: Date;
}): NeedsActionReason[] {
  if (input.productStatus !== 'active') return [];
  const reasons: NeedsActionReason[] = [];
  if (input.awaiting > 0) reasons.push('buyer_waiting');
  const stats = input.stats;
  if (stats?.listingStatus === 'expired' || stats?.listingStatus === 'error') {
    reasons.push('listing_problem');
  } else if (
    stats &&
    stats.listingStatus === 'live' &&
    !stats.stale &&
    stats.viewsDelta7d === 0 &&
    stats.oldestLivePublishedAt !== null &&
    input.now.getTime() - stats.oldestLivePublishedAt.getTime() >= GROWTH_WINDOW_MS
  ) {
    reasons.push('no_view_growth');
  }
  return reasons;
}

// Ascending order; a product without a value always sorts after every product with one.
export function compareByStats(
  a: ProductStats | undefined,
  b: ProductStats | undefined,
  field: 'views' | 'viewsDelta7d'
): number {
  const left = a?.[field] ?? null;
  const right = b?.[field] ?? null;
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}
