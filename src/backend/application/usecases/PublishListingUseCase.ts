// Use case: publish a listing to its marketplace. Publishing is asynchronous — the
// use case loads the listing/product/marketplace, verifies the publish preconditions
// (marketplace connected, product publishable, price set), records the intent in the
// activity log and enqueues a publish job. The job (Group 6) performs the marketplace
// call and finalizes the listing via ListingService with the returned external id.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  DomainError,
  NotFoundError,
  InvalidStateError,
  GuardrailViolationError,
} from '../../domain/shared/DomainError';
import type { Listing } from '../../domain/entities/Listing';
import type { Product } from '../../domain/entities/Product';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IJobQueue, PublishListingJob } from '../ports/IJobQueue';
import type { IdGenerator } from '../ports/IdGenerator';
import type { PublishListingDTO } from '../dto/PublishListingDTO';
import type { MarketplaceAccountRepository } from '../services/MarketplaceOAuthService';
import type { OlxPublicationQuotaService } from '../services/OlxPublicationQuotaService';
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';

const PreflightState = Annotation.Root({
  input: Annotation<PublishListingDTO>(),
  listing: Annotation<Listing | undefined>(),
  product: Annotation<Product | undefined>(),
  marketplace: Annotation<Marketplace | undefined>(),
  operationId: Annotation<string | undefined>(),
});

type PreflightGraphState = typeof PreflightState.State;
export const PUBLICATION_PREFLIGHT_GRAPH_VERSION = 'publication-preflight@1';

export interface PublishEligibility {
  canPublish: boolean;
  warnings: string[];
  error?: GuardrailViolationError | InvalidStateError;
}

export function evaluatePublishEligibility(
  listing: Listing,
  product: Product,
  marketplace: Marketplace
): PublishEligibility {
  const warnings: string[] = [];
  let error: GuardrailViolationError | InvalidStateError | undefined;

  if (!marketplace.isConnected()) {
    warnings.push(`Marketplace ${marketplace.key} is not connected`);
    error ??= new GuardrailViolationError(
      `Marketplace ${marketplace.key} must be connected before publishing`
    );
  }
  if (!product.canPublish()) {
    warnings.push('Cannot publish a sold product');
    error ??= new InvalidStateError('Cannot publish a listing for a sold product');
  }
  if (listing.price.isZero()) {
    warnings.push('Listing price must be set before publish');
    error ??= new InvalidStateError('Listing price must be set before publish');
  }

  return { canPublish: warnings.length === 0, warnings, error };
}

export class PublishListingUseCase {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly productRepo: IProductRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly publishQueue: IJobQueue<PublishListingJob>,
    private readonly activityLog: IActivityLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly marketplaceAccountRepo?: MarketplaceAccountRepository,
    private readonly olxQuota?: OlxPublicationQuotaService,
  ) {}

  private preflightGraph() {
    return new StateGraph(PreflightState)
      .addNode('load', async (state: PreflightGraphState) => {
        const listing = await this.listingRepo.findById(state.input.listingId);
        if (!listing) throw new NotFoundError(`Listing not found: ${state.input.listingId}`);
        const mode = state.input.mode ?? 'publish';
        const relistable = listing.status === 'expired'
          || (listing.status === 'error' && !listing.marketplaceListingId);
        if (mode === 'relist' && !relistable) {
          throw new InvalidStateError(
            `Cannot relist a listing in ${listing.status} status while it may still reference an existing marketplace advert`,
          );
        }
        const product = await this.productRepo.findById(listing.productId);
        if (!product) throw new NotFoundError(`Product not found: ${listing.productId}`);
        const marketplace = await this.marketplaceRepo.findById(listing.marketplaceId);
        if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
        return { listing, product, marketplace };
      })
      .addNode('eligibility', (state: PreflightGraphState) => {
        const decision = evaluatePublishEligibility(state.listing!, state.product!, state.marketplace!);
        if (!decision.canPublish) throw decision.error ?? new InvalidStateError(decision.warnings[0]);
        return {};
      })
      .addNode('account', async (state: PreflightGraphState) => {
        if (this.marketplaceAccountRepo) {
          const account = await this.marketplaceAccountRepo.findByMarketplaceId(state.marketplace!.id);
          if (!account || account.status !== 'connected') {
            throw new GuardrailViolationError(
              `Marketplace ${state.marketplace!.key} OAuth account must be connected before publishing`,
            );
          }
        }
        return {};
      })
      .addNode('category', (state: PreflightGraphState) => {
        if (state.marketplace!.key === 'olx') {
          const categoryDecision = evaluateOlxCategory(state.product!, state.listing!.marketplaceCategory);
          if (!categoryDecision.allowed) {
            throw new GuardrailViolationError(
              categoryDecision.message ?? 'OLX category validation blocks publication',
              { categoryDecision, marketplaceCategory: state.listing!.marketplaceCategory },
            );
          }
        }
        return { operationId: this.idGenerator() };
      })
      .addNode('quota', async (state: PreflightGraphState) => {
        if (state.marketplace!.key !== 'olx') return {};
        if (!this.olxQuota) {
          throw new GuardrailViolationError(
            'OLX publication quota guard is unavailable; publication fails closed',
            { quotaDecision: {
              applicable: true,
              marketplaceKey: 'olx',
              status: 'unknown',
              decision: 'block',
              reason: 'quota_guard_unavailable',
              requiresOverride: true,
            } },
          );
        }
        const decision = await this.olxQuota.authorize({
          operationId: state.operationId!,
          mode: state.input.mode ?? 'publish',
          listing: state.listing!,
          product: state.product!,
          marketplace: state.marketplace!,
          actorId: state.input.actorId,
          override: state.input.quotaOverride,
        });
        if (decision.decision === 'block') throw this.olxQuota.guardError(decision);
        return {};
      })
      .addEdge(START, 'load')
      .addEdge('load', 'eligibility')
      .addEdge('eligibility', 'account')
      .addEdge('account', 'category')
      .addEdge('category', 'quota')
      .addEdge('quota', END)
      .compile();
  }

  async execute(input: PublishListingDTO): Promise<Result<Listing>> {
    let state: PreflightGraphState;
    try {
      state = await this.preflightGraph().invoke({ input });
    } catch (error) {
      if (error instanceof DomainError) return Err(error);
      throw error;
    }
    const listing = state.listing!;
    const product = state.product!;
    const marketplace = state.marketplace!;
    const operationId = state.operationId!;
    const mode = input.mode ?? 'publish';
    await this.publishQueue.enqueue(
      {
        operationId,
        mode,
        listingUpdatedAt: listing.updatedAt.toISOString(),
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
      },
      { jobId: `publish:${operationId}` }
    );

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: product.workspaceId,
      entityType: 'listing',
      entityId: listing.id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'listing.publish_requested',
      metadata: {
        marketplaceKey: marketplace.key,
        productId: product.id,
        workflowVersion: PUBLICATION_PREFLIGHT_GRAPH_VERSION,
      },
      createdAt: new Date(),
    });

    return Ok(listing);
  }
}
