import { Result, Ok, Err } from '../../domain/shared/Result';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IPriceHistoryRecorder } from '../ports/IPriceHistoryRecorder';
import type { IdGenerator } from '../ports/IdGenerator';
import type { PriceSync } from '../../../shared/types';
import type { MarketplaceUpdateEnqueuer } from './MarketplaceUpdateEnqueuer';

export interface ApplyPriceChangeInput {
  workspaceId: string;
  productId: string;
  price: number;
  changedBy: 'user' | 'hermes';
  allowBelowCost: boolean;
  reason?: string | null;
}

export class PriceChangeService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly priceHistory: IPriceHistoryRecorder,
    private readonly enqueuer: MarketplaceUpdateEnqueuer,
    private readonly idGenerator: IdGenerator
  ) {}

  async apply(input: ApplyPriceChangeInput): Promise<Result<PriceSync>> {
    const product = await this.productRepo.findByIdForWorkspace(input.productId, input.workspaceId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${input.productId}`));
    }

    const money = Money.of(input.price, product.sellingPrice.currency);
    if (money.isErr()) return money;

    if (money.value.equals(product.sellingPrice)) {
      return Ok({ unchanged: true, marketplaceUpdates: [], skippedLiveListings: [] });
    }

    if (product.minAcceptablePrice && money.value.isLessThan(product.minAcceptablePrice)) {
      return Err(new InvalidStateError('The new price is below the lowest price you accept'));
    }
    const oldPrice = product.sellingPrice.amount;
    const updated = product.updateSellingPrice(money.value, input.allowBelowCost);
    if (updated.isErr()) return updated;
    await this.productRepo.save(product);

    const listings = await this.listingRepo.findByProduct(product.id);
    const now = new Date();
    for (const listing of listings) {
      const listingPrice = Money.of(input.price, listing.price.currency);
      if (listingPrice.isErr()) return listingPrice;
      const listingUpdated = listing.updatePrice(listingPrice.value);
      if (listingUpdated.isErr()) return listingUpdated;
      await this.listingRepo.save(listing);
      await this.priceHistory.record({
        id: this.idGenerator(),
        listingId: listing.id,
        oldPrice,
        newPrice: input.price,
        changedBy: input.changedBy,
        reason: input.reason ?? undefined,
        createdAt: now,
      });
    }

    const queued = await this.enqueuer.enqueue(product, { price: input.price });
    return Ok({ unchanged: false, ...queued });
  }
}
