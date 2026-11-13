import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IAnalyticsEventRepository, AnalyticsEventRecord } from '../ports/IAnalyticsEventRepository';
import type { ProductStatus, ListingStatus } from '../../../shared/types';

function counter(value: number | null): number { return value ?? 0; }

export interface AnalyticsRange {
  from: Date;
  to: Date;
  marketplaceId?: string;
  interval?: 'day' | 'week' | 'month';
}

export interface PeriodMetrics {
  currency: string | null;
  revenue: number | null;
  profit: number | null;
  totalViews: number;
  sales: number;
  conversion: number;
}

export interface DashboardMetrics extends PeriodMetrics {
  workspaceId: string;
  productCount: number;
  productsByStatus: Record<ProductStatus, number>;
  listingCount: number;
  listingsByStatus: Record<ListingStatus, number>;
  liveListingCount: number;
  totalWatchers: number;
  totalMessages: number;
  inventoryValue: number;
  previous: PeriodMetrics | null;
}

function aggregate(events: AnalyticsEventRecord[]): PeriodMetrics {
  let revenue = 0;
  let cost = 0;
  let revenueComplete = true;
  let costComplete = true;
  let currency: string | null = null;
  let totalViews = 0;
  let sales = 0;
  for (const event of events) {
    if (event.eventType === 'view') totalViews += event.quantity;
    if (event.eventType === 'sale') {
      sales += event.quantity;
      if (!event.currency || (currency !== null && currency !== event.currency)) {
        revenueComplete = false;
        costComplete = false;
      } else currency = event.currency;
      if (event.amount === null) revenueComplete = false;
      else revenue += event.amount;
      if (event.costAtSale === null) costComplete = false;
      else cost += event.costAtSale * event.quantity;
    }
  }
  return {
    currency: revenueComplete ? currency : null,
    revenue: revenueComplete ? revenue : null,
    profit: revenueComplete && costComplete ? revenue - cost : null,
    totalViews,
    sales,
    conversion: totalViews > 0 ? (sales / totalViews) * 100 : 0,
  };
}

export class AnalyticsApplicationService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly analyticsEvents?: IAnalyticsEventRepository,
  ) {}

  private async periodEvents(workspaceId: string, range: AnalyticsRange): Promise<AnalyticsEventRecord[]> {
    if (!this.analyticsEvents) return [];
    return this.analyticsEvents.findByRange({
      workspaceId, from: range.from, to: range.to, marketplaceId: range.marketplaceId,
    });
  }

  async getDashboardMetrics(workspaceId: string, range?: AnalyticsRange): Promise<DashboardMetrics> {
    const [allProducts, allListings] = await Promise.all([
      this.productRepo.findByWorkspace(workspaceId), this.listingRepo.findByWorkspace(workspaceId),
    ]);
    const listings = range?.marketplaceId
      ? allListings.filter((listing) => listing.marketplaceId === range.marketplaceId)
      : allListings;
    const filteredProductIds = new Set(listings.map((listing) => listing.productId));
    const products = range?.marketplaceId
      ? allProducts.filter((product) => filteredProductIds.has(product.id))
      : allProducts;
    const productsByStatus: Record<ProductStatus, number> = { draft: 0, active: 0, attention: 0, sold: 0 };
    let inventoryValue = 0;
    for (const product of products) {
      productsByStatus[product.status] += 1;
      if (product.status !== 'sold') inventoryValue += product.sellingPrice.amount;
    }
    const listingsByStatus: Record<ListingStatus, number> = { live: 0, draft: 0, expired: 0, error: 0 };
    let totalWatchers = 0;
    let currentMessages = 0;
    for (const listing of listings) {
      listingsByStatus[listing.status] += 1;
      totalWatchers += counter(listing.watchers);
      currentMessages += counter(listing.messages);
    }

    const currentEvents = range ? await this.periodEvents(workspaceId, range) : [];
    const current = range ? aggregate(currentEvents) : {
      currency: null, revenue: 0, profit: 0,
      totalViews: listings.reduce((sum, listing) => sum + counter(listing.views), 0),
      sales: 0, conversion: 0,
    };
    let previous: PeriodMetrics | null = null;
    if (range && this.analyticsEvents) {
      const duration = range.to.getTime() - range.from.getTime();
      const previousEvents = await this.periodEvents(workspaceId, {
        ...range,
        from: new Date(range.from.getTime() - duration),
        to: range.from,
      });
      previous = aggregate(previousEvents);
      if (previous.currency !== current.currency) {
        previous = { ...previous, currency: null, revenue: null, profit: null };
      }
    }
    const eventMessages = range
      ? currentEvents.filter((event) => event.eventType === 'message').reduce((sum, event) => sum + event.quantity, 0)
      : currentMessages;

    return {
      workspaceId, productCount: products.length, productsByStatus,
      listingCount: listings.length, listingsByStatus, liveListingCount: listingsByStatus.live,
      totalWatchers, totalMessages: eventMessages, inventoryValue, ...current, previous,
    };
  }
}
