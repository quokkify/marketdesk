// Gathers listings, recent view events and awaiting replies for a workspace and turns them into
// per-product catalogue statistics (views, 7-day growth, trend, needs-action reasons).
import type { ProductStats } from '@shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IAnalyticsEventRepository } from '../ports/IAnalyticsEventRepository';
import type { Listing } from '../../domain/entities/Listing';
import {
  STATS_DAYS,
  needsActionReasons,
  summarizeListingViews,
  summarizeProduct,
} from './productStats';
import type { ProductStatsSummary, StatsListing } from './productStats';

const DAY_MS = 24 * 3600 * 1000;

export interface ProductStatsDeps {
  products: Pick<IProductRepository, 'findByWorkspace'>;
  listings: Pick<IListingRepository, 'findByWorkspace'>;
  analytics: Pick<IAnalyticsEventRepository, 'findByRange' | 'baselineViewEventIds'>;
  awaitingReplyCounts?: (workspaceId: string) => Promise<Record<string, number>>;
  now?: () => Date;
}

function statsListing(listing: Listing): StatsListing {
  return {
    productId: listing.productId,
    status: listing.status,
    views: listing.views,
    watchers: listing.watchers,
    messages: listing.messages,
    lastSyncAt: listing.lastSyncAt,
    publishedAt: listing.publishedAt,
    externalUrl: listing.externalUrl,
  };
}

export class ProductStatsService {
  constructor(private readonly deps: ProductStatsDeps) {}

  async statsByProduct(workspaceId: string): Promise<Record<string, ProductStats>> {
    const now = this.deps.now?.() ?? new Date();
    const from = new Date(now.getTime() - (STATS_DAYS + 1) * DAY_MS);
    const [products, listings, events, baselineIds, awaiting] = await Promise.all([
      this.deps.products.findByWorkspace(workspaceId),
      this.deps.listings.findByWorkspace(workspaceId),
      this.deps.analytics.findByRange({ workspaceId, from, to: new Date(now.getTime() + 1) }),
      this.deps.analytics.baselineViewEventIds(workspaceId),
      this.deps.awaitingReplyCounts?.(workspaceId) ?? Promise.resolve<Record<string, number>>({}),
    ]);
    const views = summarizeListingViews(events, baselineIds, now);

    const listingsByProduct = new Map<string, Listing[]>();
    for (const listing of listings) {
      const group = listingsByProduct.get(listing.productId) ?? [];
      group.push(listing);
      listingsByProduct.set(listing.productId, group);
    }

    const result: Record<string, ProductStats> = {};
    for (const product of products) {
      const group = listingsByProduct.get(product.id);
      const summary: ProductStatsSummary | undefined = group
        ? summarizeProduct(
            group.map(statsListing),
            views,
            group.map((listing) => listing.id),
            now
          )
        : undefined;
      const reasons = needsActionReasons({
        productStatus: product.status,
        awaiting: awaiting[product.id] ?? 0,
        stats: summary,
        now,
      });
      if (!summary && reasons.length === 0) continue;
      const { oldestLivePublishedAt: _published, ...stats } = summary ?? {
        views: null,
        watchers: null,
        messages: null,
        viewsDelta7d: null,
        viewsByDay: [],
        lastSyncAt: null,
        stale: true,
        externalUrl: null,
        listingStatus: null,
        oldestLivePublishedAt: null,
      };
      result[product.id] = { ...stats, needsAction: reasons };
    }
    return result;
  }
}
