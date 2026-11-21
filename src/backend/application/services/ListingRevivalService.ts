// Brings an expired OLX advert back with the changes the owner ticked in the revival dialog: saves
// them in MarketDesk, updates the advert on OLX and reactivates it. Every refusal comes before
// anything is saved. Once OLX is involved, a refused step is reported, not thrown: the saved changes
// stay, and fresh timestamps let the owner retry from the same dialog.
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IMarketplaceAdapter, ListingPublishInput } from '../../domain/services/MarketplaceAdapter';
import type { Listing } from '../../domain/entities/Listing';
import type { Product } from '../../domain/entities/Product';
import { Money } from '../../domain/valueObjects/Money';
import type { Result } from '../../domain/shared/Result';
import {
  ConflictError,
  DomainError,
  GuardrailViolationError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../../domain/shared/DomainError';
import { OLX_CONDITION_REQUIRED_MESSAGE } from '../../domain/services/OlxCategoryGuard';
import { REVIVAL_REFUSAL_MESSAGE } from '../../domain/services/revivalRules';
import { requireBelowCostConfirmation } from '../../../shared/validation/pricing';
import type { ProductCondition } from '../../../shared/types';
import type { IdGenerator } from '../ports/IdGenerator';
import type { IPriceHistoryRecorder } from '../ports/IPriceHistoryRecorder';
import { buildListingPublishInput } from '../usecases/PublishListingUseCase';
import {
  providerFailure,
  type ListingReactivationService,
  type ReactivationAdapterResolver,
  type ReactivationOutcome,
} from './ListingReactivationService';

export type RevivalApplyOrder = 'update-then-activate' | 'activate-then-update';
// Whether OLX accepts an update of an outdated advert is undocumented; the first production run
// decides, and flipping this constant is the whole switch.
export const REVIVAL_APPLY_ORDER: RevivalApplyOrder = 'update-then-activate';

export const REVIVAL_STALE_MESSAGE =
  'The product or listing changed since the proposal; open the revival again';
export const REVIVAL_SANDBOX_MESSAGE = 'Revival is not available in sandbox mode';
export const REVIVAL_BELOW_COST_MESSAGE =
  'The price is below the cost price; confirm selling below cost to apply it';
const ACTIVITY_ACTION = 'olx.advert_revived';

export interface RevivalChanges {
  condition: ProductCondition;
  costPrice?: number;
  title?: string;
  description?: string;
  price?: number;
  allowBelowCost?: boolean;
  productUpdatedAt: string;
  listingUpdatedAt: string;
}

type RevivalField = 'condition' | 'costPrice' | 'title' | 'description' | 'price';
// Cost price stays in MarketDesk; every other field is part of the OLX advert.
const ADVERT_FIELDS: readonly RevivalField[] = ['condition', 'title', 'description', 'price'];

// `step` names the OLX step that failed, or `done`. `outcome` is the reactivation outcome, or
// `update_refused` when the update failed first and nothing was reactivated.
export interface RevivalResult {
  outcome: ReactivationOutcome | 'update_refused';
  step: 'update' | 'activate' | 'done';
  reason: string | null;
  listing: Listing;
  productUpdatedAt: string;
  listingUpdatedAt: string;
}

export interface RevivalRepositories {
  productRepo: IProductRepository;
  listingRepo: IListingRepository & {
    saveAllIfUnchanged(listings: Listing[], expectedUpdatedAt: ReadonlyMap<string, Date>): Promise<void>;
  };
  priceHistory: IPriceHistoryRecorder;
}

export interface ListingRevivalServiceDeps {
  listingRepo: IListingRepository;
  productRepo: IProductRepository;
  marketplaceRepo: IMarketplaceRepository;
  runInTransaction: <T>(work: (repositories: RevivalRepositories) => Promise<T>) => Promise<T>;
  adapters: ReactivationAdapterResolver;
  reactivation: Pick<ListingReactivationService, 'reactivate'>;
  activityLog: IActivityLogRepository;
  idGenerator: IdGenerator;
  sandboxMode: boolean;
  logger?: { warn(obj: object, msg: string): void };
}

type StepResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function assertUnchanged(product: Product, listing: Listing, changes: RevivalChanges): void {
  if (
    product.updatedAt.toISOString() !== changes.productUpdatedAt ||
    listing.updatedAt.toISOString() !== changes.listingUpdatedAt
  ) {
    throw new ConflictError(REVIVAL_STALE_MESSAGE);
  }
}

// The shared below-cost rule, checked for the new advert price and for a new cost price against
// the product's selling price (the one Product.updateCostPrice guards).
function assertNotBelowCost(product: Product, changes: RevivalChanges): void {
  const currentCostPrice = product.costPrice?.amount ?? null;
  const candidates = [{ costPrice: changes.costPrice ?? currentCostPrice, sellingPrice: changes.price }];
  if (changes.costPrice !== undefined && changes.costPrice !== currentCostPrice) {
    candidates.push({ costPrice: changes.costPrice, sellingPrice: product.sellingPrice.amount });
  }
  let belowCost = false;
  for (const candidate of candidates) {
    requireBelowCostConfirmation(
      { ...candidate, allowBelowCost: changes.allowBelowCost },
      { addIssue: () => { belowCost = true; } }
    );
  }
  if (belowCost) throw new GuardrailViolationError(REVIVAL_BELOW_COST_MESSAGE);
}

function unwrap<T>(result: Result<T>): T {
  if (result.isErr()) throw result.error;
  return result.value;
}

export class ListingRevivalService {
  constructor(private readonly deps: ListingRevivalServiceDeps) {}

  async revive(input: {
    listingId: string;
    workspaceId: string;
    actorId?: string;
    changes: RevivalChanges;
  }): Promise<RevivalResult> {
    const { listingId, workspaceId, changes } = input;
    const listing = await this.deps.listingRepo.findByIdForWorkspace(listingId, workspaceId);
    if (!listing) throw new NotFoundError(`Listing not found: ${listingId}`);
    const marketplace = await this.deps.marketplaceRepo.findByIdForWorkspace(
      listing.marketplaceId,
      workspaceId
    );
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
    const product = await this.deps.productRepo.findByIdForWorkspace(listing.productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);

    if (changes.condition === 'unknown') throw new ValidationError(OLX_CONDITION_REQUIRED_MESSAGE);
    assertUnchanged(product, listing, changes);
    const externalListingId = listing.marketplaceListingId;
    if (marketplace.key !== 'olx' || listing.status !== 'expired' || !externalListingId) {
      throw new InvalidStateError(REVIVAL_REFUSAL_MESSAGE);
    }
    assertNotBelowCost(product, changes);
    if (this.deps.sandboxMode) throw new InvalidStateError(REVIVAL_SANDBOX_MESSAGE);

    // Resolved before saving: a missing or refused OLX authorization then leaves nothing changed.
    const adapter = await this.deps.adapters.resolve(marketplace);
    const saved = await this.saveChanges(product.id, listing.id, input);
    const changedFields = saved.changedFields;
    const current = buildListingPublishInput(saved.product, saved.listing);
    const needsUpdate = changedFields.some((field) => ADVERT_FIELDS.includes(field));

    const update = (): Promise<StepResult<void>> => needsUpdate
      ? this.updateAdvert(adapter, externalListingId, changedFields, current)
      : Promise.resolve({ ok: true, value: undefined });
    let report: Pick<RevivalResult, 'outcome' | 'step' | 'reason'>;
    if (REVIVAL_APPLY_ORDER === 'update-then-activate') {
      // A refused update reactivates nothing: the advert stays expired with its old text.
      const updated = await update();
      if (!updated.ok) {
        report = { outcome: 'update_refused', step: 'update', reason: updated.reason };
      } else {
        const activated = await this.activate(input);
        report = activated.ok
          ? { outcome: activated.value, step: 'done', reason: null }
          : { outcome: 'unchanged', step: 'activate', reason: activated.reason };
      }
    } else {
      // A refused update after a reactivation leaves the advert back on OLX with its old text.
      const activated = await this.activate(input);
      if (!activated.ok) {
        report = { outcome: 'unchanged', step: 'activate', reason: activated.reason };
      } else {
        const updated = await update();
        report = updated.ok
          ? { outcome: activated.value, step: 'done', reason: null }
          : { outcome: activated.value, step: 'update', reason: updated.reason };
      }
    }
    const { outcome, step, reason } = report;

    await this.recordActivity(input, listing.id, {
      externalListingId,
      changedFields,
      applyOrder: REVIVAL_APPLY_ORDER,
      outcome,
      step,
      reason,
    });

    // Reactivation may have relisted the listing and put a draft product on sale, so both are
    // read back for the timestamps a retry must quote.
    const freshListing = await this.deps.listingRepo.findByIdForWorkspace(listing.id, workspaceId);
    const freshProduct = await this.deps.productRepo.findByIdForWorkspace(product.id, workspaceId);
    const resultListing = freshListing ?? saved.listing;
    return {
      outcome,
      step,
      reason,
      listing: resultListing,
      productUpdatedAt: (freshProduct ?? saved.product).updatedAt.toISOString(),
      listingUpdatedAt: resultListing.updatedAt.toISOString(),
    };
  }

  // One transaction: the product row lock makes a concurrent apply wait and then see the changed
  // timestamps, and the listing is written only if no one changed it in between.
  private async saveChanges(
    productId: string,
    listingId: string,
    input: { workspaceId: string; changes: RevivalChanges }
  ): Promise<{ product: Product; listing: Listing; changedFields: RevivalField[] }> {
    const { workspaceId, changes } = input;
    return this.deps.runInTransaction(async (repositories) => {
      const product = await repositories.productRepo.findByIdForWorkspaceForUpdate(productId, workspaceId);
      const listing = await repositories.listingRepo.findByIdForWorkspace(listingId, workspaceId);
      if (!product) throw new NotFoundError(`Product not found: ${productId}`);
      if (!listing) throw new NotFoundError(`Listing not found: ${listingId}`);
      assertUnchanged(product, listing, changes);
      const listingVersion = listing.updatedAt;
      const oldPrice = listing.price.amount;
      const changedFields: RevivalField[] = [];

      if (changes.condition !== product.condition) changedFields.push('condition');
      // Always applied, even when unchanged, so the product's timestamp moves and a second apply
      // quoting the old one is refused as stale.
      unwrap(product.updateCondition(changes.condition));
      if (changes.costPrice !== undefined && changes.costPrice !== product.costPrice?.amount) {
        const costPrice = unwrap(Money.of(changes.costPrice, product.sellingPrice.currency));
        unwrap(product.updateCostPrice(costPrice, changes.allowBelowCost === true));
        changedFields.push('costPrice');
      }
      if (changes.title !== undefined && changes.title !== product.name) {
        unwrap(product.rename(changes.title));
        changedFields.push('title');
      }
      if (changes.description !== undefined && changes.description !== product.description) {
        unwrap(product.updateDescription(changes.description));
        changedFields.push('description');
      }
      if (changes.price !== undefined && changes.price !== oldPrice) {
        unwrap(listing.updatePrice(unwrap(Money.of(changes.price, listing.price.currency))));
        changedFields.push('price');
      }

      await repositories.productRepo.save(product);
      if (changedFields.includes('price')) {
        try {
          await repositories.listingRepo.saveAllIfUnchanged(
            [listing],
            new Map([[listing.id, listingVersion]])
          );
        } catch (error) {
          if (error instanceof InvalidStateError) throw new ConflictError(REVIVAL_STALE_MESSAGE);
          throw error;
        }
        await repositories.priceHistory.record({
          id: this.deps.idGenerator(),
          listingId: listing.id,
          oldPrice,
          newPrice: listing.price.amount,
          changedBy: 'user',
          reason: 'revival',
          createdAt: listing.updatedAt,
        });
      }
      return { product, listing, changedFields };
    });
  }

  private async updateAdvert(
    adapter: IMarketplaceAdapter,
    externalListingId: string,
    changedFields: RevivalField[],
    current: ListingPublishInput
  ): Promise<StepResult<void>> {
    const changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>> = {
      ...(changedFields.includes('title') ? { productName: current.productName } : {}),
      ...(changedFields.includes('description') ? { description: current.description } : {}),
      ...(changedFields.includes('price') ? { price: current.price } : {}),
    };
    try {
      await adapter.updateListing(externalListingId, changes, current);
      return { ok: true, value: undefined };
    } catch (error) {
      return this.reported(providerFailure(error, 'update'));
    }
  }

  private async activate(input: {
    listingId: string;
    workspaceId: string;
    actorId?: string;
  }): Promise<StepResult<ReactivationOutcome>> {
    try {
      const result = await this.deps.reactivation.reactivate({
        listingId: input.listingId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
      });
      return { ok: true, value: result.outcome };
    } catch (error) {
      return this.reported(error);
    }
  }

  // A mapped refusal (OLX's reason, an unavailable OLX, a local guard) is reported as the failed
  // step; anything else is a defect and surfaces as a server error.
  private reported(error: unknown): { ok: false; reason: string } {
    if (error instanceof DomainError) return { ok: false, reason: error.message };
    throw error;
  }

  // The changes are saved and OLX may have acted; a failed audit write is logged, not reported.
  private async recordActivity(
    input: { workspaceId: string; actorId?: string },
    listingId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.deps.activityLog.record({
        id: this.deps.idGenerator(),
        workspaceId: input.workspaceId,
        entityType: 'listing',
        entityId: listingId,
        actorType: 'user',
        actorId: input.actorId,
        action: ACTIVITY_ACTION,
        metadata,
        createdAt: new Date(),
      });
    } catch (error) {
      this.deps.logger?.warn(
        { listingId, error: error instanceof Error ? error.message : String(error) },
        'Revival activity could not be recorded'
      );
    }
  }
}
