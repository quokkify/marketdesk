// Brings an expired OLX advert back under its existing id (OLX `activate` command) instead of
// publishing a duplicate. Activation itself never buys anything: when the category's free limit is
// used up OLX answers with status `limited` and waits for a paid packet, which MarketDesk reports.
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import { activateDraftWithLiveListing } from '../../domain/services/productSaleStatus';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { Listing } from '../../domain/entities/Listing';
import type { IdGenerator } from '../ports/IdGenerator';
import {
  InvalidStateError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../domain/shared/DomainError';

// `unconfirmed`: OLX accepted the command but the advert could not be read back; the next sync settles it.
export type ReactivationOutcome =
  'live' | 'pending_moderation' | 'limited' | 'unchanged' | 'unconfirmed';

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
  productRepo: IProductRepository;
  adapters: ReactivationAdapterResolver;
  activityLog: IActivityLogRepository;
  idGenerator: IdGenerator;
  sandboxMode: boolean;
  logger?: { warn(obj: object, msg: string): void };
  now?: () => Date;
}

// Marketplace adapter failures carry a transport-neutral `code` (infrastructure MarketplaceError).
function providerFailure(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case 'AUTHENTICATION':
      return new InvalidStateError(
        'OLX refused the stored authorization; reconnect OLX and try again'
      );
    case 'NOT_FOUND':
      return new InvalidStateError('The advert no longer exists on OLX');
    case 'PROVIDER_REJECTION':
      return new InvalidStateError(`OLX refused to reactivate the advert: ${message}`);
    case 'RATE_LIMIT':
    case 'TRANSIENT':
      return new ServiceUnavailableError(
        'OLX is not answering right now; try again shortly',
        error
      );
    default:
      return error instanceof Error ? error : new Error(message);
  }
}

const ACTIVITY_ACTION = 'olx.advert_reactivated';
// `disabled` right after activate is OLX's "waiting for verification" (listed under Oczekujące).
const OUTCOME_BY_REMOTE_STATUS: Record<string, ReactivationOutcome> = {
  active: 'live',
  new: 'pending_moderation',
  disabled: 'pending_moderation',
  limited: 'limited',
};

export function reactivationOutcome(remoteStatus: string | null): ReactivationOutcome {
  return OUTCOME_BY_REMOTE_STATUS[(remoteStatus ?? '').toLowerCase()] ?? 'unchanged';
}

export class ListingReactivationService {
  constructor(private readonly deps: ListingReactivationServiceDeps) {}

  async reactivate(input: {
    listingId: string;
    workspaceId: string;
    actorId?: string;
  }): Promise<ReactivationResult> {
    const listing = await this.deps.listingRepo.findByIdForWorkspace(
      input.listingId,
      input.workspaceId
    );
    if (!listing) throw new NotFoundError(`Listing not found: ${input.listingId}`);
    const marketplace = await this.deps.marketplaceRepo.findByIdForWorkspace(
      listing.marketplaceId,
      input.workspaceId
    );
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
    if (marketplace.key !== 'olx') {
      throw new InvalidStateError(
        `Reactivation is not supported for marketplace ${marketplace.key}`
      );
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
      throw new InvalidStateError(
        `Reactivation is not supported for marketplace ${marketplace.key}`
      );
    }
    try {
      await adapter.reactivate(externalListingId);
    } catch (error) {
      throw providerFailure(error);
    }

    let remote: Awaited<ReturnType<IMarketplaceAdapter['fetchListing']>> = null;
    let readBackFailed = false;
    try {
      remote = await adapter.fetchListing(externalListingId);
    } catch (error) {
      readBackFailed = true;
      this.deps.logger?.warn(
        {
          listingId: listing.id,
          externalListingId,
          error: error instanceof Error ? error.message : String(error),
        },
        'OLX advert could not be read back after reactivation'
      );
    }
    const remoteStatus = remote?.remoteStatus ?? null;
    const outcome: ReactivationOutcome = readBackFailed
      ? 'unconfirmed'
      : reactivationOutcome(remoteStatus);

    if (outcome === 'live') {
      const relisted = listing.relist(this.now());
      if (relisted.isErr()) throw relisted.error;
      if (remote?.externalUrl) listing.recordExternalUrl(remote.externalUrl);
      await this.deps.listingRepo.save(listing);
      // A live advert puts a draft product on sale, as publishing does.
      const product = await this.deps.productRepo.findByIdForWorkspace(
        listing.productId,
        input.workspaceId
      );
      if (product) {
        const activated = activateDraftWithLiveListing(product, [listing]);
        if (activated.isErr()) throw activated.error;
        if (activated.value) await this.deps.productRepo.save(product);
      }
    }

    await this.recordActivity(input, listing, { externalListingId, outcome, remoteStatus });

    return { listing, outcome, remoteStatus };
  }

  // The OLX action already happened; a failed audit write is logged, not reported as a failed action.
  private async recordActivity(
    input: { workspaceId: string; actorId?: string },
    listing: Listing,
    metadata: {
      externalListingId: string;
      outcome: ReactivationOutcome;
      remoteStatus: string | null;
    }
  ): Promise<void> {
    try {
      await this.deps.activityLog.record({
        id: this.deps.idGenerator(),
        workspaceId: input.workspaceId,
        entityType: 'listing',
        entityId: listing.id,
        actorType: 'user',
        actorId: input.actorId,
        action: ACTIVITY_ACTION,
        metadata,
        createdAt: this.now(),
      });
    } catch (error) {
      this.deps.logger?.warn(
        { listingId: listing.id, error: error instanceof Error ? error.message : String(error) },
        'Reactivation activity could not be recorded'
      );
    }
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
