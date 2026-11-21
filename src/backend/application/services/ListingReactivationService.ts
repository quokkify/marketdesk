// Brings an expired OLX advert back under its existing id (OLX `activate` command) instead of
// publishing a duplicate. Activation itself never buys anything: when the category's free limit is
// used up OLX answers with status `limited` and waits for a paid packet, which MarketDesk reports.
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { Listing } from '../../domain/entities/Listing';
import type { IdGenerator } from '../ports/IdGenerator';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';

export type ReactivationOutcome = 'live' | 'pending_moderation' | 'limited' | 'unchanged';

export interface ReactivationResult {
  listing: Listing;
  outcome: ReactivationOutcome;
  remoteStatus: string | null;
}

export interface ReactivationAdapterResolver {
  resolve(marketplace: Marketplace): Promise<IMarketplaceAdapter>;
}

export interface ListingReactivationServiceDeps {
  listingRepo: IListingRepository;
  marketplaceRepo: IMarketplaceRepository;
  adapters: ReactivationAdapterResolver;
  activityLog: IActivityLogRepository;
  idGenerator: IdGenerator;
  sandboxMode: boolean;
  now?: () => Date;
}

const ACTIVITY_ACTION = 'olx.advert_reactivated';
const OUTCOME_BY_REMOTE_STATUS: Record<string, ReactivationOutcome> = {
  active: 'live',
  new: 'pending_moderation',
  limited: 'limited',
};

export class ListingReactivationService {
  constructor(private readonly deps: ListingReactivationServiceDeps) {}

  async reactivate(input: {
    listingId: string;
    workspaceId: string;
    actorId?: string;
  }): Promise<ReactivationResult> {
    const listing = await this.deps.listingRepo.findByIdForWorkspace(input.listingId, input.workspaceId);
    if (!listing) throw new NotFoundError(`Listing not found: ${input.listingId}`);
    const marketplace = await this.deps.marketplaceRepo.findByIdForWorkspace(
      listing.marketplaceId,
      input.workspaceId
    );
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
    if (marketplace.key !== 'olx') {
      throw new InvalidStateError(`Reactivation is not supported for marketplace ${marketplace.key}`);
    }
    if (this.deps.sandboxMode) {
      throw new InvalidStateError('Reactivation is not available in sandbox mode');
    }
    const externalListingId = listing.marketplaceListingId;
    if (listing.status !== 'expired' || !externalListingId) {
      throw new InvalidStateError('Only an expired listing with an OLX advert can be reactivated');
    }

    const adapter = await this.deps.adapters.resolve(marketplace);
    if (!adapter.reactivate) {
      throw new InvalidStateError(`Reactivation is not supported for marketplace ${marketplace.key}`);
    }
    const remote = await adapter.reactivate(externalListingId);
    const remoteStatus = remote?.remoteStatus ?? null;
    const outcome = OUTCOME_BY_REMOTE_STATUS[(remoteStatus ?? '').toLowerCase()] ?? 'unchanged';

    if (outcome === 'live') {
      const relisted = listing.relist(this.now());
      if (relisted.isErr()) throw relisted.error;
      if (remote?.externalUrl !== undefined) listing.recordExternalUrl(remote.externalUrl);
      await this.deps.listingRepo.save(listing);
    }

    await this.deps.activityLog.record({
      id: this.deps.idGenerator(),
      workspaceId: input.workspaceId,
      entityType: 'listing',
      entityId: listing.id,
      actorType: 'user',
      actorId: input.actorId,
      action: ACTIVITY_ACTION,
      metadata: { externalListingId, outcome, remoteStatus },
      createdAt: this.now(),
    });

    return { listing, outcome, remoteStatus };
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
