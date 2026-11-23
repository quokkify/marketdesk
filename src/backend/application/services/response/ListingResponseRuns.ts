// Starts and reads listing response runs. A request checks the product and its live OLX listing,
// frees the listing from a run stuck (its lease ended or its job was lost), hands back a fresh
// completed run for the same listing subject, or records a queued run and enqueues its ids; the
// graph runs only in the listing-response job. A listing has at most one queued or running run.

import type { ListingResponseRun, ListingResponseView } from '../../../../shared/types';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IListingResponseRunRepository } from '../../../domain/repositories/interfaces/IListingResponseRunRepository';
import { ConflictError, InvalidStateError, NotFoundError } from '../../../domain/shared/DomainError';
import type { IJobQueue, ListingResponseJob } from '../../ports/IJobQueue';
import { VERDICT_QUEUED_TTL_MS } from '../verdict/SaleVerdictRuns';
import type { Product } from '../../../domain/entities/Product';
import {
  LISTING_RESPONSE_GRAPH_VERSION,
  OLX_MARKETPLACE_KEY,
  findLiveOlxListing,
  responseFingerprint,
} from './ListingResponseGraph';

// A completed run answers repeated requests for this long while the listing subject is unchanged.
export const REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const RESPONSE_EXPIRED = 'expired';

// Structural, so the container can pass its logger.
export interface ListingResponseRunsLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface ListingResponseRunsDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct' | 'findByWorkspace'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace' | 'findByWorkspace'>;
  runs: IListingResponseRunRepository;
  queue: IJobQueue<ListingResponseJob>;
  newId: () => string;
  now: () => Date;
  logger?: ListingResponseRunsLogger;
}

export class ListingResponseRuns {
  constructor(private readonly deps: ListingResponseRunsDeps) {}

  async request(
    workspaceId: string,
    productId: string,
  ): Promise<{ run: ListingResponseRun; enqueued: boolean; reused: boolean }> {
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    const { listing } = await findLiveOlxListing(this.deps, workspaceId, productId);

    const now = this.deps.now();
    await this.expireStuck(workspaceId, listing.id, now);
    const fingerprint = responseFingerprint(product, listing);
    const latest = await this.deps.runs.findLatestCompleted(workspaceId, listing.id);
    if (
      latest &&
      latest.fingerprint === fingerprint &&
      latest.graphVersion === LISTING_RESPONSE_GRAPH_VERSION &&
      latest.completedAt !== null &&
      now.getTime() - new Date(latest.completedAt).getTime() < REUSE_WINDOW_MS
    ) {
      return { run: latest, enqueued: false, reused: true };
    }

    const run = await this.deps.runs.insertQueued({
      id: this.deps.newId(),
      workspaceId,
      productId,
      listingId: listing.id,
      graphVersion: LISTING_RESPONSE_GRAPH_VERSION,
      fingerprint,
      queuedAt: now.toISOString(),
    });
    if (!run) {
      const active = await this.deps.runs.findActive(workspaceId, listing.id);
      if (!active) throw new ConflictError('The listing response run just ended, please try again');
      return { run: active, enqueued: false, reused: false };
    }
    try {
      await this.deps.queue.enqueue({ workspaceId, productId, runId: run.id });
    } catch (error) {
      this.deps.logger?.error({ productId, runId: run.id, err: error }, 'Listing response run not queued');
      await this.deps.runs.fail(run.id, this.deps.now().toISOString(), 'enqueue_failed');
      throw error;
    }
    return { run, enqueued: true, reused: false };
  }

  async view(workspaceId: string, productId: string): Promise<ListingResponseView> {
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    let listing;
    try {
      ({ listing } = await findLiveOlxListing(this.deps, workspaceId, productId));
    } catch (error) {
      if (error instanceof InvalidStateError) return { latest: null, active: null, lastFailed: false, outOfDate: false };
      throw error;
    }
    await this.expireStuck(workspaceId, listing.id, this.deps.now());
    const [latest, active, newest] = await Promise.all([
      this.deps.runs.findLatestCompleted(workspaceId, listing.id),
      this.deps.runs.findActive(workspaceId, listing.id),
      this.deps.runs.findNewest(workspaceId, listing.id),
    ]);
    return {
      latest,
      active,
      lastFailed: newest?.status === 'failed',
      outOfDate: latest !== null && latest.fingerprint !== responseFingerprint(product, listing),
    };
  }

  // Per product, the latest completed run of the listing a new run would check (the first live
  // listing, on OLX, with a marketplace id), with the same out-of-date rule as view().
  async latestFor(
    workspaceId: string,
    products: ReadonlyArray<Pick<Product, 'id' | 'name'>>,
  ): Promise<Map<string, { run: ListingResponseRun; outOfDate: boolean }>> {
    const [listings, marketplaces, runs] = await Promise.all([
      this.deps.listings.findByWorkspace(workspaceId),
      this.deps.marketplaces.findByWorkspace(workspaceId),
      this.deps.runs.findLatestCompletedForProducts(workspaceId, products.map((product) => product.id)),
    ]);
    const olx = new Set(marketplaces.filter((m) => m.key === OLX_MARKETPLACE_KEY).map((m) => m.id));
    const result = new Map<string, { run: ListingResponseRun; outOfDate: boolean }>();
    for (const product of products) {
      const run = runs.get(product.id);
      const live = listings.find((l) => l.productId === product.id && l.status === 'live');
      if (!run || !live || !olx.has(live.marketplaceId) || !live.marketplaceListingId) continue;
      if (run.listingId !== live.id) continue;
      result.set(product.id, { run, outOfDate: run.fingerprint !== responseFingerprint(product, live) });
    }
    return result;
  }

  // A run stuck for good would block the listing: written as failed before anything reads or inserts.
  private async expireStuck(workspaceId: string, listingId: string, now: Date): Promise<void> {
    await this.deps.runs.failExpired(
      workspaceId,
      listingId,
      now.toISOString(),
      new Date(now.getTime() - VERDICT_QUEUED_TTL_MS).toISOString(),
      RESPONSE_EXPIRED,
    );
  }
}
