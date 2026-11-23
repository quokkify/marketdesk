import type { Listing } from '../../../domain/entities/Listing';
import type { Product } from '../../../domain/entities/Product';
import { ProductStatsService } from '../ProductStatsService';

const now = new Date('2026-11-23T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);

const fakeListing = (id: string, status: Listing['status']): Listing =>
  ({
    id,
    productId: 'p1',
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

  it('has no response without a live listing', async () => {
    const stats = await serviceFor([fakeListing('old', 'expired')]).statsByProduct('w1');
    expect(stats['p1']!.response).toBeNull();
  });
});
