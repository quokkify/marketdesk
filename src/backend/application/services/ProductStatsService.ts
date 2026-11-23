// Gathers listings, recent view events and awaiting replies for a workspace and turns them into
// per-product catalogue statistics (views, 7-day growth, trend, needs-action reasons).
import type { ProductStats } from '@shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IAnalyticsEventRepository } from '../ports/IAnalyticsEventRepository';
import type { Listing } from '../../domain/entities/Listing';
import {
  STATS_DAYS,
  listingResponseSignal,
  needsActionReasons,
  nonSyncViewEventIds,
  summarizeListingViews,
  summarizeProduct,
  toResponseListing,
} from './productStats';
import type { ProductStatsSummary } from './productStats';

const DAY_MS = 24 * 3600 * 1000;

export interface ProductStatsDeps {
  products: Pick<IProductRepository, 'findByWorkspace'>;
  listings: Pick<IListingRepository, 'findByWorkspace'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByWorkspace'>;
  analytics: Pick<IAnalyticsEventRepository, 'findByRange'>;
  awaitingReplyCounts?: (workspaceId: string) => Promise<Record<string, number>>;
  now?: () => Date;
}

export class ProductStatsService {
  constructor(private readonly deps: ProductStatsDeps) {}

  async statsByProduct(workspaceId: string): Promise<Record<string, ProductStats>> {
    const now = this.deps.now?.() ?? new Date();
    const from = new Date(now.getTime() - (STATS_DAYS + 1) * DAY_MS);
    const [products, listings, marketplaces, events, awaiting] = await Promise.all([
      this.deps.products.findByWorkspace(workspaceId),
      this.deps.listings.findByWorkspace(workspaceId),
      this.deps.marketplaces.findByWorkspace(workspaceId),
      this.deps.analytics.findByRange({ workspaceId, from, to: new Date(now.getTime() + 1) }),
      this.deps.awaitingReplyCounts?.(workspaceId) ?? Promise.resolve<Record<string, number>>({}),
    ]);
    const views = summarizeListingViews(events, nonSyncViewEventIds(events), now);
    const olx = new Set(marketplaces.filter((m) => m.key === 'olx').map((m) => m.id));

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
            group.map(toResponseListing),
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
      // No stage for a live listing a response run would refuse (not on OLX or no OLX id).
      const liveListing = group?.find((listing) => listing.status === 'live');
      const response =
        liveListing && olx.has(liveListing.marketplaceId) && liveListing.marketplaceListingId
          ? listingResponseSignal(toResponseListing(liveListing), views.get(liveListing.id), now)
          : null;
      result[product.id] = { ...stats, needsAction: reasons, response };
    }
    return result;
  }
}
