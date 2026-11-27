// Raises the "OLX advert category mismatch" recommendation: the event plus its delist and recreate
// intents. Runs on the repositories of the caller's transaction, so the event and the intents commit
// together with whatever the caller is saving.
import type { Product } from '../../domain/entities/Product';
import type { Listing } from '../../domain/entities/Listing';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { ICategoryCorrectionOperationRepository } from '../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { MarketplaceCategoryMetadata } from '../../../shared/types';
import { InvalidStateError } from '../../domain/shared/DomainError';
import type { IdGenerator } from '../ports/IdGenerator';
import type { MarketplaceAccountRepository } from './MarketplaceOAuthService';

export interface CategoryMismatchRepositories {
  eventRepo: IEventRepository;
  correctionOperations: ICategoryCorrectionOperationRepository;
  activityLog?: IActivityLogRepository;
}

export interface CategoryMismatchBaseRepositories extends CategoryMismatchRepositories {
  accounts: Pick<MarketplaceAccountRepository, 'findByMarketplaceId'>;
}

export class CategoryMismatchProposals {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly base?: CategoryMismatchBaseRepositories,
  ) {}

  // The caller has already decided the category is a mismatch and chose the proposed category; this
  // always builds and saves, and is idempotent through the recommendation key. Without `account` it
  // binds the listing marketplace's connected account; without `repositories` it uses the base ones.
  // Returns the new event, or null when the same recommendation already exists.
  async raise(input: {
    workspaceId: string;
    product: Product;
    listing: Listing;
    currentCategory: MarketplaceCategoryMetadata;
    proposedCategory: MarketplaceCategoryMetadata | null;
    account?: { id: string; revision: number };
    repositories?: CategoryMismatchRepositories;
  }): Promise<HermesEvent | null> {
    const { workspaceId, product, listing, currentCategory, proposedCategory } = input;
    const repositories = input.repositories ?? this.base;
    if (!repositories) {
      throw new InvalidStateError('CategoryMismatchProposals has no repositories');
    }
    const { eventRepo, correctionOperations, activityLog } = repositories;
    let account = input.account;
    if (!account) {
      const connected = await this.base?.accounts.findByMarketplaceId(listing.marketplaceId);
      if (!connected || connected.status !== 'connected') {
        throw new InvalidStateError('The marketplace account is not connected');
      }
      account = { id: connected.id, revision: connected.revision };
    }
    const usableProposedCategory = proposedCategory;
    const eventId = this.idGenerator();
    const delistIntentId = this.idGenerator();
    const recreateIntentId = this.idGenerator();
    const created = HermesEvent.create({
      id: eventId,
      workspaceId,
      productId: product.id,
      type: 'olx_category_mismatch',
      severity: 'critical',
      status: 'pending_review',
      title: 'OLX advert category mismatch requires recreation',
      detail: `Current: ${currentCategory.path.join(' → ')}. Proposed: ${usableProposedCategory ? usableProposedCategory.path.join(' → ') : 'select an exact verified OLX leaf category'}. OLX category is not corrected through a normal PUT; delist and recreate remain separate human-reviewed operations.`,
      proposedChange: {
        kind: 'category_recreation',
        listingId: listing.id,
        currentCategory,
        proposedCategory: usableProposedCategory,
        operations: [
          {
            kind: 'delist', intentId: delistIntentId, status: 'pending_review',
            providerSideEffectAllowed: false, quotaUnitsRestored: 0,
          },
          {
            kind: 'recreate', intentId: recreateIntentId,
            status: 'blocked_pending_quota_review', providerSideEffectAllowed: false,
            quotaGuardRequired: true,
          },
        ],
      },
      autonomyDecision: 'pending_review',
    });
    if (created.isErr()) throw created.error;
    const inserted = await eventRepo.saveRecommendationIfAbsent(
      created.value,
      `olx-category-mismatch:${listing.id}:${currentCategory.providerCategoryId}:${usableProposedCategory?.providerCategoryId ?? 'unresolved'}`,
    );
    if (!inserted) return null;
    const requestedAt = new Date();
    await correctionOperations.createPair(
      {
        id: delistIntentId, workspaceId, recommendationEventId: eventId,
        listingId: listing.id, marketplaceId: listing.marketplaceId, kind: 'delist',
        state: 'requested', targetCategory: null, paidOverrideReason: null,
        requestedBy: null, approvedBy: null, result: {
          externalListingId: listing.marketplaceListingId,
          externalUrl: listing.externalUrl,
          requestedListingUpdatedAt: listing.updatedAt.toISOString(),
          marketplaceAccountId: account.id,
          marketplaceAccountRevision: account.revision,
        }, requestedAt,
        approvedAt: null, executedAt: null, failedAt: null, updatedAt: requestedAt,
      },
      {
        id: recreateIntentId, workspaceId, recommendationEventId: eventId,
        listingId: listing.id, marketplaceId: listing.marketplaceId, kind: 'recreate',
        state: 'requested', targetCategory: usableProposedCategory, paidOverrideReason: null,
        requestedBy: null, approvedBy: null, result: null, requestedAt,
        approvedAt: null, executedAt: null, failedAt: null, updatedAt: requestedAt,
      },
    );
    await activityLog?.record({
      id: this.idGenerator(),
      workspaceId,
      entityType: 'listing',
      entityId: listing.id,
      actorType: 'hermes',
      actorId: undefined,
      action: 'olx.category_recreation_recommended',
      metadata: {
        eventId,
        currentCategory,
        proposedCategory: usableProposedCategory,
        delistIntentId,
        recreateIntentId,
        deletionRestoresQuota: false,
        recreateRequiresQuotaGuard: true,
      },
      createdAt: new Date(),
    });
    return created.value;
  }
}
