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

    const listings = await this.listingRepo.findByProduct(product.id);
    const productDiffers = !money.value.equals(product.sellingPrice);
    const listingTargets: { listing: (typeof listings)[number]; price: Money }[] = [];
    for (const listing of listings) {
      const listingPrice = Money.of(input.price, listing.price.currency);
      if (listingPrice.isErr()) return listingPrice;
      if (!listingPrice.value.equals(listing.price)) {
        listingTargets.push({ listing, price: listingPrice.value });
      }
    }

    // Unchanged only when the product and every listing already carry this price; a listing
    // that drifted from the product is repaired here instead of being reported as in sync.
    if (!productDiffers && listingTargets.length === 0) {
      return Ok({ unchanged: true, marketplaceUpdates: [], skippedLiveListings: [] });
    }

    if (productDiffers) {
      if (product.minAcceptablePrice && money.value.isLessThan(product.minAcceptablePrice)) {
        return Err(new InvalidStateError('The new price is below the lowest price you accept'));
      }
      const updated = product.updateSellingPrice(money.value, input.allowBelowCost);
      if (updated.isErr()) return updated;
      // No row lock or transaction here: a concurrent product edit can be lost. This was already
      // true for Hermes and is now shared by the listing dialog; a transaction is a non-goal.
      await this.productRepo.save(product);
    }

    const now = new Date();
    for (const { listing, price } of listingTargets) {
      const oldPrice = listing.price.amount;
      const listingUpdated = listing.updatePrice(price);
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
