// Per-product view statistics and "needs action" reasons for the products catalogue.
// Pure functions: the service gathers listings, view events and awaiting counts, these decide.
import type {
  ListingResponseSignal,
  ListingStatus,
  NeedsActionReason,
  ProductStats,
  ProductStatus,
} from '@shared/types';

export const STATS_DAYS = 14;
export const GROWTH_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const STALE_AFTER_MS = 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
export const YOUNG_MS = 48 * HOUR_MS;
export const NOT_SEEN_MAX_VIEWS = 30;
export const NOT_SEEN_MAX_VIEWS_PER_DAY = 3;
export const ENOUGH_VIEWS = 80;

export interface ViewEventInput {
  id: string;
  listingId: string | null;
  eventType: string;
  quantity: number;
  occurredAt: Date;
}

// Sync records view deltas through AnalyticsEventRepository.appendMany, whose ids are
// deterministic UUID v5 values; seeded pre-tracking totals (migrations 038/039) get random v4 ids.
const SYNC_RECORDED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/i;

export function isSyncRecordedEventId(id: string): boolean {
  return SYNC_RECORDED_ID.test(id);
}

// View events that hold a pre-tracking total rather than growth.
export function nonSyncViewEventIds(events: ReadonlyArray<ViewEventInput>): Set<string> {
  return new Set(
    events
      .filter((event) => event.eventType === 'view' && !isSyncRecordedEventId(event.id))
      .map((event) => event.id)
  );
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

export interface ResponseListing extends StatsListing {
  id: string;
  conversations: number | null;
}

export type ProductStatsSummary = Omit<ProductStats, 'needsAction' | 'response'> & {
  oldestLivePublishedAt: Date | null;
};

const STATUS_SEVERITY: Record<ListingStatus, number> = { live: 0, draft: 1, expired: 2, error: 3 };

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Baseline events (seeded pre-tracking totals, see nonSyncViewEventIds) are never growth.
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

export function listingResponseSignal(
  listing: ResponseListing,
  views: ListingViews | undefined,
  now: Date
): ListingResponseSignal {
  const hoursLive = listing.publishedAt
    ? (now.getTime() - listing.publishedAt.getTime()) / HOUR_MS
    : null;
  const recent = (views?.byDay ?? Array<number>(STATS_DAYS).fill(0)).slice(
    STATS_DAYS - 4,
    STATS_DAYS - 1
  );
  const viewsPerDay = recent.reduce((sum, count) => sum + count, 0) / recent.length;
  const signal = (stage: ListingResponseSignal['stage'], viewsNeeded: number | null = null) => ({
    listingId: listing.id,
    stage,
    views: listing.views,
    viewsPerDay,
    hoursLive,
    viewsNeeded,
  });

  const stale =
    !listing.lastSyncAt || now.getTime() - listing.lastSyncAt.getTime() > STALE_AFTER_MS;
  if (
    listing.status !== 'live' ||
    hoursLive === null ||
    stale ||
    listing.views === null ||
    (listing.watchers === null && listing.conversations === null)
  ) {
    return signal('no_data');
  }
  if ((listing.watchers ?? 0) > 0 || (listing.conversations ?? 0) > 0) return signal('responding');
  if (hoursLive * HOUR_MS < YOUNG_MS) return signal('too_early');
  if (listing.views <= NOT_SEEN_MAX_VIEWS && viewsPerDay <= NOT_SEEN_MAX_VIEWS_PER_DAY) {
    return signal('not_seen');
  }
  if (listing.views >= ENOUGH_VIEWS) return signal('seen_not_contacted');
  return signal('too_early', ENOUGH_VIEWS);
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
