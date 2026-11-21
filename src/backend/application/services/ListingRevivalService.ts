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
export const REVIVAL_NO_PHOTOS_MESSAGE = 'Add at least one photo before reviving the advert on OLX';
export const REVIVAL_ADVERT_BELOW_COST_MESSAGE =
  'The advert price is below the cost price; confirm selling below cost to apply it';
export const REVIVAL_PRODUCT_BELOW_COST_MESSAGE =
  "The product's selling price is below the new cost price; confirm selling below cost to apply it";
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

function isBelowCost(costPrice: number | null | undefined, sellingPrice: number, allowBelowCost?: boolean): boolean {
  let belowCost = false;
  requireBelowCostConfirmation(
    { costPrice, sellingPrice, allowBelowCost },
    { addIssue: () => { belowCost = true; } }
  );
  return belowCost;
}

// The shared below-cost rule. The advert price (new or current) must not fall below the cost price
// (new or known). A new cost price is also checked against the product's selling price, because
// Product.updateCostPrice enforces that pair.
function assertNotBelowCost(product: Product, listing: Listing, changes: RevivalChanges): void {
  const currentCostPrice = product.costPrice?.amount ?? null;
  const costPrice = changes.costPrice ?? currentCostPrice;
  const advertPrice = changes.price ?? listing.price.amount;
  if (isBelowCost(costPrice, advertPrice, changes.allowBelowCost)) {
    throw new GuardrailViolationError(REVIVAL_ADVERT_BELOW_COST_MESSAGE);
  }
  if (
    changes.costPrice !== undefined &&
    changes.costPrice !== currentCostPrice &&
    isBelowCost(changes.costPrice, product.sellingPrice.amount, changes.allowBelowCost)
  ) {
    throw new GuardrailViolationError(REVIVAL_PRODUCT_BELOW_COST_MESSAGE);
  }
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
    // The update PUTs the whole advert, so a product without photos would strip them from OLX.
    if (product.images.length === 0) throw new InvalidStateError(REVIVAL_NO_PHOTOS_MESSAGE);
    assertNotBelowCost(product, listing, changes);
    if (this.deps.sandboxMode) throw new InvalidStateError(REVIVAL_SANDBOX_MESSAGE);

    // Resolved before saving: a missing or refused OLX authorization then leaves nothing changed.
    const adapter = await this.deps.adapters.resolve(marketplace);
    const saved = await this.saveChanges(product.id, listing.id, input);
    const changedFields = saved.changedFields;
    const current = buildListingPublishInput(saved.product, saved.listing);

    // The update is always sent, even when nothing differs from what MarketDesk stores: after a
    // refused update the changes are already saved, and a retry must still put them on OLX before
    // (or after) reactivating. The PUT carries the whole advert anyway.
    const update = (): Promise<StepResult<void>> =>
      this.updateAdvert(adapter, externalListingId, changedFields, current);
    let report: Pick<RevivalResult, 'outcome' | 'step' | 'reason'>;
    if (REVIVAL_APPLY_ORDER === 'update-then-activate') {
      // A refused update reactivates nothing: the advert stays expired with its old text.
      const updated = await update();
      if (!updated.ok) {
        report = { outcome: 'update_refused', step: 'update', reason: updated.reason };
      } else {
        const activated = await this.activate(input, externalListingId);
        report = activated.ok
          ? { outcome: activated.value, step: 'done', reason: null }
          : { outcome: 'unchanged', step: 'activate', reason: activated.reason };
      }
    } else {
      // A refused update after a reactivation leaves the advert back on OLX with its old text.
      const activated = await this.activate(input, externalListingId);
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
      if (changes.title !== undefined && changes.title.trim() !== product.name) {
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
      return this.reported('update', externalListingId, providerFailure(error, 'update'));
    }
  }

  private async activate(
    input: { listingId: string; workspaceId: string; actorId?: string },
    externalListingId: string
  ): Promise<StepResult<ReactivationOutcome>> {
    try {
      const result = await this.deps.reactivation.reactivate({
        listingId: input.listingId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
      });
      return { ok: true, value: result.outcome };
    } catch (error) {
      return this.reported('activate', externalListingId, error);
    }
  }

  // The changes are already saved, so every failure of an OLX step is reported, never thrown: the
  // owner gets the step, the reason and fresh timestamps, and the activity row is written. A
  // failure that maps to no known OLX answer (adapter guard, network error, UNKNOWN code) is also
  // logged as a possible defect.
  private reported(
    step: 'update' | 'activate',
    externalListingId: string,
    error: unknown
  ): { ok: false; reason: string } {
    const reason = error instanceof Error ? error.message : String(error);
    if (!(error instanceof DomainError)) {
      this.deps.logger?.warn(
        { step, externalListingId, error: reason },
        'Revival step failed without a known OLX answer; possible defect'
      );
    }
    return { ok: false, reason };
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
