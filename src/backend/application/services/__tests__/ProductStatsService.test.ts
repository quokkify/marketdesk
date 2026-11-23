import type { Listing } from '../../../domain/entities/Listing';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { Product } from '../../../domain/entities/Product';
import { ProductStatsService } from '../ProductStatsService';

const now = new Date('2026-11-23T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);

const fakeListing = (
  id: string,
  status: Listing['status'],
  over: Partial<Pick<Listing, 'marketplaceId' | 'marketplaceListingId'>> = {}
): Listing =>
  ({
    id,
    productId: 'p1',
    marketplaceId: 'm-olx',
    marketplaceListingId: `9${id.length}00`,
    ...over,
    status,
    views: 17,
    watchers: 0,
    conversations: 0,
    messages: 0,
    lastSyncAt: hoursAgo(1),
    publishedAt: hoursAgo(96),
    externalUrl: `https://olx.example/${id}`,
  }) as unknown as Listing;

const serviceFor = (listings: Listing[]) =>
  new ProductStatsService({
    products: {
      findByWorkspace: async () => [{ id: 'p1', status: 'active' } as unknown as Product],
    },
    listings: { findByWorkspace: async () => listings },
    marketplaces: {
      findByWorkspace: async () => [
        { id: 'm-olx', key: 'olx' } as unknown as Marketplace,
        { id: 'm-other', key: 'allegro' } as unknown as Marketplace,
      ],
    },
    analytics: { findByRange: async () => [] },
    now: () => now,
  });

describe('ProductStatsService response signal', () => {
  it("takes the response from the product's live listing", async () => {
    const stats = await serviceFor([
      fakeListing('old', 'expired'),
      fakeListing('current', 'live'),
    ]).statsByProduct('w1');
    expect(stats['p1']!.response).toMatchObject({ listingId: 'current', stage: 'not_seen' });
  });

  it('has no response for a live listing that is not on OLX', async () => {
    const stats = await serviceFor([
      fakeListing('current', 'live', { marketplaceId: 'm-other' }),
    ]).statsByProduct('w1');
    expect(stats['p1']!.response).toBeNull();
  });

  it('has no response for a live listing without a marketplace listing id', async () => {
    const stats = await serviceFor([
      fakeListing('current', 'live', { marketplaceListingId: null }),
    ]).statsByProduct('w1');
    expect(stats['p1']!.response).toBeNull();
  });

  it('has no response without a live listing', async () => {
    const stats = await serviceFor([fakeListing('old', 'expired')]).statsByProduct('w1');
    expect(stats['p1']!.response).toBeNull();
  });
});
