// Use case: update a product. Loads the aggregate once, applies only the provided
// mutations through the entity (which enforces invariants), persists a single time
// and emits one domain event. Forward-only status transitions and price/description
// bounds are guaranteed by the Product entity.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import { Product } from '../../domain/entities/Product';
import { buildPricingDecision } from '../../domain/services/pricingDecision';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';
import { ProductValidator } from '../validators/ProductValidator';
import type { PriceChangeService } from '../services/PriceChangeService';
import type { PriceSync } from '../../../shared/types';

export interface UpdatedProduct {
  product: Product;
  priceSync?: PriceSync;
}

interface PersistedProductUpdate {
  product: Product;
  deferredSellingPrice?: number;
  pricing: {
    pricesChanged: boolean;
    belowCostConfirmed: boolean;
    previousCostPrice: number | null;
    previousSellingPrice: number;
  };
}

export class UpdateProductUseCase {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly runInTransaction?: <T>(
      work: (productRepo: IProductRepository) => Promise<T>,
    ) => Promise<T>,
    private readonly validator: ProductValidator = new ProductValidator(),
    private readonly priceChange?: PriceChangeService
  ) {}

  async execute(input: UpdateProductDTO): Promise<Result<Product>> {
    const result = await this.executeWithPriceSync(input);
    return result.isErr() ? result : Ok(result.value.product);
  }

  async executeWithPriceSync(input: UpdateProductDTO): Promise<Result<UpdatedProduct>> {
    const validated = this.validator.validateUpdate(input);
    if (validated.isErr()) return validated;
    const dto = validated.value;

    // The other fields (cost, floor, status, ...) are saved first and validated against the
    // TARGET selling price; the price itself then goes through PriceChangeService, whose
    // checks see the saved fields. A refusal before the commit saves nothing, and after it
    // only the service's own pre-checked refusals remain, so a refused edit never leaves a
    // price live on OLX.
    // The deferred selling price is committed only by priceChange.apply below (commitSellingPrice=false
    // in updatePrices): if apply throws after this commit, floor/cost may briefly exceed the stored price.
    const persisted = this.runInTransaction
      ? await this.runInTransaction((productRepo) => this.executeValidated(dto, productRepo, true))
      : await this.executeValidated(dto, this.productRepo, false);
    if (persisted.isErr()) return persisted;
    let { product } = persisted.value;

    let priceSync: PriceSync | undefined;
    const deferredPrice = persisted.value.deferredSellingPrice;
    if (this.priceChange && deferredPrice !== undefined) {
      const applied = await this.priceChange.apply({
        workspaceId: dto.workspaceId,
        productId: dto.productId,
        price: deferredPrice,
        changedBy: 'user',
        allowBelowCost: dto.allowBelowCost === true,
      });
      if (applied.isErr()) return applied;
      // An unchanged price reports no sync, so a plain edit keeps its "Product updated" message.
      if (!applied.value.unchanged) priceSync = applied.value;
      const reloaded = await this.productRepo.findByIdForWorkspace(dto.productId, dto.workspaceId);
      if (reloaded) product = reloaded;
    }

    try {
      await this.eventPublisher.publish(this.updatedEvent(product, persisted.value.pricing));
    } catch {
      // Product already committed; don't fail the request over best-effort delivery.
    }
    return Ok({ product, ...(priceSync ? { priceSync } : {}) });
  }

  private async executeValidated(
    dto: UpdateProductDTO,
    productRepo: IProductRepository,
    lockProduct: boolean,
  ): Promise<Result<PersistedProductUpdate>> {

    // Tenant-scoped load: a product in another workspace reads as not-found so a
    // cross-tenant id cannot be mutated (S2).
    const product = lockProduct
      ? await productRepo.findByIdForWorkspaceForUpdate(dto.productId, dto.workspaceId)
      : await productRepo.findByIdForWorkspace(dto.productId, dto.workspaceId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${dto.productId}`));
    }
    const previousCostPrice = product.costPrice?.amount ?? null;
    const previousSellingPrice = product.sellingPrice.amount;

    if (dto.name !== undefined) {
      const r = product.rename(dto.name);
      if (r.isErr()) return r;
    }

    if (dto.description !== undefined) {
      const r = product.updateDescription(dto.description);
      if (r.isErr()) return r;
    }

    let clearCostPrice = false;
    let nextCostPrice: Money | null = null;
    if (dto.costPrice !== undefined) {
      if (dto.costPrice === null) {
        clearCostPrice = true;
      } else {
        const price = Money.of(
          dto.costPrice,
          dto.currency ?? product.costPrice?.currency ?? product.sellingPrice.currency
        );
        if (price.isErr()) return price;
        nextCostPrice = price.value;
      }
    }

    let nextSellingPrice: Money | null = null;
    if (dto.sellingPrice !== undefined) {
      const price = Money.of(dto.sellingPrice, dto.currency ?? product.sellingPrice.currency);
      if (price.isErr()) return price;
      nextSellingPrice = price.value;
    }

    let nextMinAcceptable: Money | null | undefined;
    if (dto.minAcceptablePrice === null) {
      nextMinAcceptable = null;
    } else if (dto.minAcceptablePrice !== undefined) {
      const price = Money.of(
        dto.minAcceptablePrice,
        dto.currency ?? product.sellingPrice.currency
      );
      if (price.isErr()) return price;
      nextMinAcceptable = price.value;
    }

    // The service applies a same-currency price after this save; the entity only validates it here.
    const deferSellingPrice = this.priceChange !== undefined && nextSellingPrice !== null
      && nextSellingPrice.currency === product.sellingPrice.currency;
    const priceUpdate = product.updatePrices(
      nextCostPrice,
      nextSellingPrice,
      dto.allowBelowCost ?? false,
      nextMinAcceptable,
      !deferSellingPrice
    );
    if (priceUpdate.isErr()) return priceUpdate;
    if (clearCostPrice) product.clearCostPrice();

    if (dto.missingAccessories !== undefined) {
      const r = product.updateMissingAccessories(dto.missingAccessories);
      if (r.isErr()) return r;
    }

    if (dto.condition !== undefined) {
      const r = product.updateCondition(dto.condition);
      if (r.isErr()) return r;
    }

    if (dto.category !== undefined) {
      const r = product.updateCategory(dto.category);
      if (r.isErr()) return r;
    }

    if (dto.tags !== undefined) {
      for (const tag of [...product.tags]) product.removeTag(tag);
      for (const tag of dto.tags) {
        const r = product.addTag(tag);
        if (r.isErr()) return r;
      }
    }

    if (dto.images !== undefined) {
      product.clearImages();
      for (const url of dto.images) {
        const r = product.addImage(url);
        if (r.isErr()) return r;
      }
    }

    // Status is applied last so it cannot be undone by an earlier failure.
    if (dto.status !== undefined && dto.status !== product.status) {
      const r = product.transitionTo(dto.status);
      if (r.isErr()) return r;
    }

    await productRepo.save(product);

    return Ok({
      product,
      ...(deferSellingPrice && nextSellingPrice ? { deferredSellingPrice: nextSellingPrice.amount } : {}),
      pricing: {
        pricesChanged: dto.costPrice !== undefined || dto.sellingPrice !== undefined,
        belowCostConfirmed: dto.allowBelowCost === true,
        previousCostPrice,
        previousSellingPrice,
      },
    });
  }

  private updatedEvent(
    product: Product,
    pricing: {
      pricesChanged: boolean;
      belowCostConfirmed: boolean;
      previousCostPrice: number | null;
      previousSellingPrice: number;
    }
  ): DomainEvent {
    const payload: Record<string, unknown> = {
      productId: product.id,
      workspaceId: product.workspaceId,
    };
    if (pricing.pricesChanged) {
      payload.pricingDecision = buildPricingDecision(product, pricing.belowCostConfirmed, {
          costPrice: pricing.previousCostPrice,
          sellingPrice: pricing.previousSellingPrice,
      });
    }
    return {
      type: 'product.updated',
      aggregateType: 'Product',
      aggregateId: product.id,
      payload,
      occurredAt: new Date(),
    };
  }
}
