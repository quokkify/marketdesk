import { PriceChangeService } from '../services/PriceChangeService';
import { MarketplaceUpdateEnqueuer } from '../services/MarketplaceUpdateEnqueuer';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  unwrap,
  money,
} from '../../domain/testkit/support';
import {
  RecordingPriceHistoryRecorder,
  RecordingJobQueue,
  idFactory,
} from '../testkit/support';
import type { PublishListingJob } from '../ports/IJobQueue';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';

function makeListing(id: string, extra: { live?: boolean } = {}) {
  return unwrap(
    Listing.create({
      id,
      productId: 'prod-1',
      marketplaceId: 'mp-1',
      price: money(100),
      ...(extra.live ? { marketplaceListingId: `olx-${id}`, status: 'live' as const } : {}),
    })
  );
}

function setup(accountConnected = true) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const priceHistory = new RecordingPriceHistoryRecorder();
  const publishQueue = new RecordingJobQueue<PublishListingJob>();

  const product = unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Lamp',
      description: 'A beautiful vintage brass lamp in excellent condition.',
      costPrice: money(50),
      sellingPrice: money(100),
      condition: 'good',
      category: 'home',
    })
  );
  productRepo.items.set(product.id, product);
  const marketplace = unwrap(
    Marketplace.create({ id: 'mp-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true })
  );
  marketplaceRepo.items.set(marketplace.id, marketplace);

  const accountRepo = {
    findByMarketplaceId: async (marketplaceId: string) =>
      accountConnected
        ? {
            id: 'account-1',
            marketplaceId,
            handle: 'OLX account',
            credentials: {},
            status: 'connected' as const,
            scopes: ['basic'],
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    upsert: async () => {
      throw new Error('not used');
    },
    updateConnectedIfUnchanged: async () => {
      throw new Error('not used');
    },
  };
  const enqueuer = new MarketplaceUpdateEnqueuer(
    listingRepo,
    marketplaceRepo,
    publishQueue,
    idFactory('op'),
    accountRepo
  );
  const service = new PriceChangeService(
    productRepo,
    listingRepo,
    priceHistory,
    enqueuer,
    idFactory('hist')
  );
  return { service, productRepo, listingRepo, priceHistory, publishQueue, product };
}

const input = {
  workspaceId: 'ws-1',
  productId: 'prod-1',
  changedBy: 'user' as const,
  allowBelowCost: false,
};

describe('PriceChangeService', () => {
  it('appliesToEveryListing', async () => {
    const { service, listingRepo, priceHistory, productRepo } = setup();
    listingRepo.items.set('l1', makeListing('l1'));
    listingRepo.items.set('l2', makeListing('l2'));

    const result = unwrap(await service.apply({ ...input, price: 120, changedBy: 'user' }));

    expect(result.unchanged).toBe(false);
    expect((await productRepo.findById('prod-1'))?.sellingPrice.amount).toBe(120);
    expect([...listingRepo.items.values()].map((l) => l.price.amount)).toEqual([120, 120]);
    expect(priceHistory.records).toHaveLength(2);
    expect(priceHistory.records.every((r) => r.changedBy === 'user')).toBe(true);
    expect(priceHistory.records.every((r) => r.oldPrice === 100 && r.newPrice === 120)).toBe(true);
  });

  it('queuesOnlyLiveOlxListings', async () => {
    const { service, listingRepo, publishQueue } = setup();
    listingRepo.items.set('live', makeListing('live', { live: true }));
    listingRepo.items.set('draft', makeListing('draft'));

    const result = unwrap(await service.apply({ ...input, price: 130 }));

    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data.listingId).toBe('live');
    expect(publishQueue.jobs[0].data.changes).toEqual({ price: 130 });
    expect(result.marketplaceUpdates.map((u) => u.listingId)).toEqual(['live']);
    expect(result.skippedLiveListings).toEqual([]);
  });

  it('unchangedPriceDoesNothing', async () => {
    const { service, listingRepo, priceHistory, publishQueue } = setup();
    listingRepo.items.set('live', makeListing('live', { live: true }));

    const result = unwrap(await service.apply({ ...input, price: 100 }));

    expect(result).toEqual({ unchanged: true, marketplaceUpdates: [], skippedLiveListings: [] });
    expect(priceHistory.records).toHaveLength(0);
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('repairsAListingThatDriftedFromTheProduct', async () => {
    const { service, listingRepo, priceHistory, publishQueue, productRepo } = setup();
    const drifted = unwrap(
      Listing.create({
        id: 'live',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        price: money(120),
        marketplaceListingId: 'olx-live',
        status: 'live' as const,
      })
    );
    listingRepo.items.set('live', drifted);
    listingRepo.items.set('same', makeListing('same'));

    const result = unwrap(await service.apply({ ...input, price: 100 }));

    expect(result.unchanged).toBe(false);
    expect(listingRepo.items.get('live')?.price.amount).toBe(100);
    expect((await productRepo.findById('prod-1'))?.sellingPrice.amount).toBe(100);
    expect(priceHistory.records).toHaveLength(1);
    expect(priceHistory.records[0]).toMatchObject({ listingId: 'live', oldPrice: 120, newPrice: 100 });
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data.listingId).toBe('live');
    expect(publishQueue.jobs[0].data.changes).toEqual({ price: 100 });
  });

  it('refusesBelowMinimum', async () => {
    const { service, listingRepo, priceHistory, publishQueue, productRepo, product } = setup();
    unwrap(product.updateMinAcceptablePrice(money(95)));
    await productRepo.save(product);
    listingRepo.items.set('live', makeListing('live', { live: true }));

    const result = await service.apply({ ...input, price: 90 });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(InvalidStateError);
      expect(result.error.message).toBe('The new price is below the lowest price you accept');
    }
    expect((await productRepo.findById('prod-1'))?.sellingPrice.amount).toBe(100);
    expect([...listingRepo.items.values()][0].price.amount).toBe(100);
    expect(priceHistory.records).toHaveLength(0);
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('reportsSkippedWhenAccountDisconnected', async () => {
    const { service, listingRepo, publishQueue, priceHistory } = setup(false);
    listingRepo.items.set('live', makeListing('live', { live: true }));

    const result = unwrap(await service.apply({ ...input, price: 140 }));

    expect(result.unchanged).toBe(false);
    expect(result.marketplaceUpdates).toEqual([]);
    expect(result.skippedLiveListings).toEqual([
      { listingId: 'live', reason: 'marketplace_account_not_connected' },
    ]);
    expect(publishQueue.jobs).toHaveLength(0);
    expect(priceHistory.records).toHaveLength(1);
  });

  it('refusesProductOfAnotherWorkspace', async () => {
    const { service } = setup();
    const result = await service.apply({ ...input, workspaceId: 'ws-2', price: 120 });
    expect(result.isErr() && result.error).toBeInstanceOf(NotFoundError);
  });

  it('refusesBelowCostUnlessConfirmed', async () => {
    const { service, listingRepo, priceHistory, productRepo } = setup();
    listingRepo.items.set('l1', makeListing('l1'));

    const refused = await service.apply({ ...input, price: 40, allowBelowCost: false });

    expect(refused.isErr()).toBe(true);
    expect((await productRepo.findById('prod-1'))?.sellingPrice.amount).toBe(100);
    expect(listingRepo.items.get('l1')?.price.amount).toBe(100);
    expect(priceHistory.records).toHaveLength(0);

    unwrap(await service.apply({ ...input, price: 40, allowBelowCost: true }));
    expect((await productRepo.findById('prod-1'))?.sellingPrice.amount).toBe(40);
    expect(listingRepo.items.get('l1')?.price.amount).toBe(40);
    expect(priceHistory.records).toHaveLength(1);
  });
});
