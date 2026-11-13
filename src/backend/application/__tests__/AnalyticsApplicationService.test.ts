import { AnalyticsApplicationService } from '../services/AnalyticsApplicationService';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import type {
  AnalyticsEventRecord,
  IAnalyticsEventRepository,
} from '../ports/IAnalyticsEventRepository';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const service = new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo);
  return { service, productRepo, listingRepo, marketplaceRepo };
}

describe('AnalyticsApplicationService', () => {
  it('uses persisted events for canonical current/previous metrics and marketplace-filtered overview', async () => {
    const { productRepo, listingRepo, marketplaceRepo } = setup();
    const product = unwrap(Product.create({
      id: 'product-1', workspaceId: 'ws-1', sku: 'SKU-1', name: 'Camera',
      description: 'Camera with complete details and accessories', costPrice: money(50),
      sellingPrice: money(120), condition: 'good', category: 'cameras',
    }));
    const marketplace = unwrap(Marketplace.create({
      id: 'marketplace-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true,
    }));
    const listing = unwrap(Listing.create({
      id: 'listing-1', productId: product.id, marketplaceId: marketplace.id,
      price: money(120), status: 'live',
    }));
    productRepo.items.set(product.id, product);
    marketplaceRepo.items.set(marketplace.id, marketplace);
    listingRepo.items.set(listing.id, listing);
    listingRepo.listingWorkspaces.set(listing.id, 'ws-1');
    const otherProduct = unwrap(Product.create({
      id: 'product-2', workspaceId: 'ws-1', sku: 'SKU-2', name: 'Laptop',
      description: 'Laptop with complete details and accessories', costPrice: money(500),
      sellingPrice: money(800), condition: 'good', category: 'laptops',
    }));
    const otherMarketplace = unwrap(Marketplace.create({
      id: 'marketplace-2', workspaceId: 'ws-1', key: 'ebay', name: 'eBay', connected: true,
    }));
    const otherListing = unwrap(Listing.create({
      id: 'listing-2', productId: otherProduct.id, marketplaceId: otherMarketplace.id,
      price: money(800), status: 'live',
    }));
    productRepo.items.set(otherProduct.id, otherProduct);
    marketplaceRepo.items.set(otherMarketplace.id, otherMarketplace);
    listingRepo.items.set(otherListing.id, otherListing);
    listingRepo.listingWorkspaces.set(otherListing.id, 'ws-1');
    const event = (
      id: string, eventType: AnalyticsEventRecord['eventType'], occurredAt: string,
      quantity: number, amount: number | null = null, costAtSale: number | null = null,
      marketplaceId = marketplace.id,
    ): AnalyticsEventRecord => ({
      id, workspaceId: 'ws-1', listingId: listing.id, marketplaceId,
      currency: eventType === 'sale' ? (marketplaceId === 'marketplace-2' ? 'USD' : 'PLN') : null,
      eventType, occurredAt: new Date(occurredAt), quantity, amount, costAtSale,
    });
    const events = [
      event('current-views', 'view', '2026-07-05T10:00:00Z', 100),
      event('current-sale', 'sale', '2026-07-06T10:00:00Z', 2, 200, 50),
      event('previous-views', 'view', '2026-06-25T10:00:00Z', 50),
      event('previous-sale', 'sale', '2026-06-26T10:00:00Z', 1, 100, 40),
      event('other-market', 'sale', '2026-07-06T12:00:00Z', 1, 999, 1, 'marketplace-2'),
    ];
    const analyticsEvents: IAnalyticsEventRepository = {
      async findByRange(query) {
        return events.filter((item) => item.workspaceId === query.workspaceId
          && item.occurredAt >= query.from && item.occurredAt < query.to
          && (!query.marketplaceId || item.marketplaceId === query.marketplaceId));
      },
    };
    const service = new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo, analyticsEvents);
    const range = {
      from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-11T00:00:00Z'),
      marketplaceId: marketplace.id, interval: 'day' as const,
    };

    const overview = await service.getDashboardMetrics('ws-1', range);
    expect(overview).toMatchObject({
      productCount: 1, listingCount: 1, inventoryValue: 120,
      revenue: 200, profit: 100, totalViews: 100, sales: 2, conversion: 2,
      previous: { revenue: 100, profit: 60, totalViews: 50, sales: 1, conversion: 2 },
    });

    const mixedCurrencyRange = { ...range, marketplaceId: undefined };
    const mixedOverview = await service.getDashboardMetrics('ws-1', mixedCurrencyRange);
    expect(mixedOverview).toMatchObject({ currency: null, revenue: null, profit: null, sales: 3 });

    events[1].costAtSale = null;
    const incompleteOverview = await service.getDashboardMetrics('ws-1', range);
    expect(incompleteOverview.revenue).toBe(200);
    expect(incompleteOverview.profit).toBeNull();
  });
});
