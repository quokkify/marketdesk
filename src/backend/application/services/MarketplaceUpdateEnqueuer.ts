import type { Listing } from '../../domain/entities/Listing';
import type { Product } from '../../domain/entities/Product';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IJobQueue, PublishListingJob, ListingUpdateJobChanges } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { MarketplaceUpdateOperation } from '../../../shared/types';
import type { MarketplaceAccountRepository } from './MarketplaceOAuthService';

export interface MarketplaceUpdateEnqueueOptions {
  requireAllLiveTargets?: boolean;
}

export interface MarketplaceUpdateEnqueueResult {
  marketplaceUpdates: MarketplaceUpdateOperation[];
  skippedLiveListings: Array<{ listingId: string; reason: string }>;
}

export class MarketplaceUpdateEnqueuer {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly publishQueue: IJobQueue<PublishListingJob>,
    private readonly idGenerator: IdGenerator,
    private readonly marketplaceAccountRepo?: MarketplaceAccountRepository
  ) {}

  isLiveTarget(listing: Listing): boolean {
    return listing.isLive() && Boolean(listing.marketplaceListingId);
  }

  async enqueue(
    product: Product,
    changes: ListingUpdateJobChanges,
    options: MarketplaceUpdateEnqueueOptions = {}
  ): Promise<MarketplaceUpdateEnqueueResult> {
    const queueItems: Array<{
      operation: MarketplaceUpdateOperation;
      data: PublishListingJob;
      options: { jobId: string };
    }> = [];
    const skippedLiveListings: Array<{ listingId: string; reason: string }> = [];
    const listings = await this.listingRepo.findByProduct(product.id);
    for (const listing of listings) {
      if (!this.isLiveTarget(listing)) continue;

      const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
        listing.marketplaceId,
        product.workspaceId
      );
      if (!marketplace || !marketplace.isConnected()) {
        skippedLiveListings.push({ listingId: listing.id, reason: 'marketplace_not_connected' });
        continue;
      }
      if (this.marketplaceAccountRepo) {
        const account = await this.marketplaceAccountRepo.findByMarketplaceId(marketplace.id);
        if (!account || account.status !== 'connected') {
          skippedLiveListings.push({
            listingId: listing.id,
            reason: 'marketplace_account_not_connected',
          });
          continue;
        }
      }

      const operationId = this.idGenerator();
      queueItems.push({
        operation: { operationId, listingId: listing.id, marketplaceId: marketplace.id },
        options: { jobId: `update:${operationId}` },
        data: {
          operationId,
          mode: 'update',
          listingUpdatedAt: listing.updatedAt.toISOString(),
          productUpdatedAt: product.updatedAt.toISOString(),
          marketplaceKey: marketplace.key,
          marketplaceId: marketplace.id,
          listingId: listing.id,
          input: {
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            marketplaceCategory: listing.marketplaceCategory,
            condition: product.condition,
            imageUrls: [...product.images],
          },
          changes,
        },
      });
    }
    if (options.requireAllLiveTargets && skippedLiveListings.length > 0) {
      return { marketplaceUpdates: [], skippedLiveListings };
    }
    await this.publishQueue.enqueueAll(
      queueItems.map((item) => ({ data: item.data, options: item.options }))
    );
    return {
      marketplaceUpdates: queueItems.map((item) => item.operation),
      skippedLiveListings,
    };
  }
}
