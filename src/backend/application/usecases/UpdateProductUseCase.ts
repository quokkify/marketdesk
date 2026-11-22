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
    let dto = validated.value;

    // The selling price goes through PriceChangeService first, so a refused price saves
    // nothing; the remaining fields are then saved as before. Cost and floor edits sent
    // together with the price are checked against the stored values at that point.
    let priceSync: PriceSync | undefined;
    let previousSellingPrice: number | undefined;
    if (this.priceChange && dto.sellingPrice !== undefined) {
      const current = await this.productRepo.findByIdForWorkspace(dto.productId, dto.workspaceId);
      if (!current) return Err(new NotFoundError(`Product not found: ${dto.productId}`));
      if (dto.currency === undefined || dto.currency === current.sellingPrice.currency) {
        previousSellingPrice = current.sellingPrice.amount;
        // The DTO validator has already demanded confirmation against a cost sent in the
        // same request, so only the stored cost is left for the service to check.
        const applied = await this.priceChange.apply({
          workspaceId: dto.workspaceId,
          productId: dto.productId,
          price: dto.sellingPrice,
          changedBy: 'user',
          allowBelowCost: dto.allowBelowCost === true || dto.costPrice !== undefined,
        });
        if (applied.isErr()) return applied;
        priceSync = applied.value;
        dto = { ...dto, sellingPrice: undefined };
      }
    }

    const persisted = this.runInTransaction
      ? await this.runInTransaction((productRepo) => this.executeValidated(dto, productRepo, true, previousSellingPrice))
      : await this.executeValidated(dto, this.productRepo, false, previousSellingPrice);
    if (persisted.isErr()) return persisted;

    try {
      await this.eventPublisher.publish(this.updatedEvent(persisted.value.product, persisted.value.pricing));
    } catch {
      // Product already committed; don't fail the request over best-effort delivery.
    }
    return Ok({ product: persisted.value.product, ...(priceSync ? { priceSync } : {}) });
  }

  private async executeValidated(
    dto: UpdateProductDTO,
    productRepo: IProductRepository,
    lockProduct: boolean,
    appliedFromSellingPrice?: number,
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
    const previousSellingPrice = appliedFromSellingPrice ?? product.sellingPrice.amount;

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

    const priceUpdate = product.updatePrices(
      nextCostPrice,
      nextSellingPrice,
      dto.allowBelowCost ?? false,
      nextMinAcceptable
    );
    if (priceUpdate.isErr()) return priceUpdate;
    if (clearCostPrice) product.clearCostPrice();

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
      pricing: {
        pricesChanged:
          dto.costPrice !== undefined || dto.sellingPrice !== undefined || appliedFromSellingPrice !== undefined,
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
