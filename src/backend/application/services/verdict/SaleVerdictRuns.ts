// Starts and reads sale verdict runs. A request checks the product, frees the product from a run
// stuck (its lease ended or its job was lost), records a queued run and enqueues its ids; the
// graph runs only in the sale-verdict job. A product has at most one queued or running run.
// recheckInfo is the synchronous Recheck: its result is the Recheck's own, and the info check over
// it is stored as a completed verdict run.

import type {
  ProductRecheckResult,
  ProductVerdictView,
  SaleVerdict,
  VerdictCheckName,
} from '../../../../shared/types';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../../domain/repositories/interfaces/IWorkspaceRepository';
import type { ISaleVerdictRepository } from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type { IPriceResearchRunRepository } from '../../../domain/repositories/interfaces/IPriceResearchRunRepository';
import { ConflictError, NotFoundError } from '../../../domain/shared/DomainError';
import { combineVerdict } from '../../../domain/services/saleVerdictRules';
import { nextAutoAt } from '../../../domain/services/researchSchedule';
import type { IJobQueue, SaleVerdictJob } from '../../ports/IJobQueue';
import type { ProductRecheckService } from '../ProductRecheckService';
import { SALE_VERDICT_GRAPH_VERSION, type CheckGraph } from './SaleVerdictGraph';

// A running run ends with its lease. A queued run may wait behind other jobs (one job at a time per
// process, each up to the run budget), so only a long wait means its job was lost.
export const VERDICT_QUEUED_TTL_MS = 60 * 60 * 1000;
// The lease of a synchronous Recheck write.
const RECHECK_LEASE_MS = 2 * 60 * 1000;
export const VERDICT_EXPIRED = 'expired';

export const ANALYSIS_RUNNING = 'An analysis is already running for this product. Try again when it finishes.';

export type VerdictTrigger = 'manual' | 'research';

// Structural, so the container can pass its logger.
export interface SaleVerdictRunsLogger {
  error(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
}

export interface SaleVerdictRunsDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByIdForWorkspace'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>;
  workspaces: Pick<IWorkspaceRepository, 'findById'>;
  verdicts: ISaleVerdictRepository;
  // A forced research is recorded as a queued run at request time, so readers see it at once.
  researchRuns: Pick<IPriceResearchRunRepository, 'insertQueued' | 'findActive' | 'findLastFinished' | 'finish'>;
  queue: IJobQueue<SaleVerdictJob>;
  recheck: Pick<ProductRecheckService, 'recheck'>;
  // The info check over a given Recheck; the container builds it code-only.
  infoCheckFor: (recheck: Pick<ProductRecheckService, 'recheck'>) => CheckGraph;
  newId: () => string;
  now: () => Date;
  logger?: SaleVerdictRunsLogger;
}

export class SaleVerdictRuns {
  constructor(private readonly deps: SaleVerdictRunsDeps) {}

  async request(
    workspaceId: string,
    productId: string,
    scope: VerdictCheckName[],
    trigger: VerdictTrigger,
    opts: { forceResearch?: boolean } = {},
  ): Promise<{ run: SaleVerdict; enqueued: boolean }> {
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);

    const now = this.deps.now();
    await this.expireStuck(workspaceId, productId, now);
    const run = await this.deps.verdicts.insertQueued({
      id: this.deps.newId(),
      workspaceId,
      productId,
      graphVersion: SALE_VERDICT_GRAPH_VERSION,
      scope,
      queuedAt: now.toISOString(),
    });
    if (!run) {
      // One active run per product is the rule: a request whose scope the active run does not cover
      // (e.g. a synchronous Recheck write) gets that run back with enqueued: false and asks again.
      const active = await this.deps.verdicts.findActive(workspaceId, productId);
      if (!active) throw new ConflictError('The sale verdict run just ended, please try again');
      // A forced research joins an active run that already forces it; any other active run would drop it.
      if (opts.forceResearch && !(await this.forcesPriceResearch(workspaceId, productId, active))) throw new ConflictError(ANALYSIS_RUNNING);
      return { run: active, enqueued: false };
    }
    await this.enqueue(workspaceId, run, trigger, opts.forceResearch ?? false, now);
    return { run, enqueued: true };
  }

  async recheckInfo(
    workspaceId: string,
    productId: string,
    listingId: string,
    actorId?: string,
  ): Promise<ProductRecheckResult> {
    const result = await this.deps.recheck.recheck({ productId, listingId, workspaceId, actorId });
    try {
      await this.storeInfoVerdict(workspaceId, productId, listingId, result);
    } catch (error) {
      this.deps.logger?.error({ productId, listingId, err: error }, 'Storing the sale verdict of a recheck failed');
    }
    return result;
  }

  async view(workspaceId: string, productId: string): Promise<ProductVerdictView> {
    if (!(await this.deps.products.findByIdForWorkspace(productId, workspaceId))) {
      throw new NotFoundError(`Product not found: ${productId}`);
    }
    await this.expireStuck(workspaceId, productId, this.deps.now());
    const [latest, active, [newest]] = await Promise.all([
      this.deps.verdicts.findLatestCompleted(workspaceId, productId),
      this.deps.verdicts.findActive(workspaceId, productId),
      this.deps.verdicts.listForProduct(workspaceId, productId, 1),
    ]);
    const lastFailed = newest?.status === 'failed';
    return { latest, active, lastFailed, lastFailedCode: lastFailed ? newest.errorCode : null };
  }

  async history(workspaceId: string, productId: string, limit: number): Promise<SaleVerdict[]> {
    if (!(await this.deps.products.findByIdForWorkspace(productId, workspaceId))) {
      throw new NotFoundError(`Product not found: ${productId}`);
    }
    await this.expireStuck(workspaceId, productId, this.deps.now());
    return this.deps.verdicts.listForProduct(workspaceId, productId, limit);
  }

  async viewsFor(
    workspaceId: string,
    productIds: string[],
  ): Promise<{ latest: Map<string, SaleVerdict>; failed: Set<string> }> {
    const [latest, failed] = await Promise.all([
      this.deps.verdicts.findLatestCompletedForProducts(workspaceId, productIds),
      this.deps.verdicts.lastRunFailedForProducts(workspaceId, productIds),
    ]);
    return { latest, failed };
  }

  // Manual research runs exist only for a forced research.
  private async forcesPriceResearch(workspaceId: string, productId: string, active: SaleVerdict): Promise<boolean> {
    if (!active.scope.includes('price')) return false;
    const research = await this.deps.researchRuns.findActive(workspaceId, productId);
    return research?.trigger === 'manual';
  }

  // Null id when the product already has a queued or running research run.
  private async queueResearch(workspaceId: string, productId: string, now: Date): Promise<string | undefined> {
    const queued = await this.deps.researchRuns.insertQueued({
      id: this.deps.newId(),
      workspaceId,
      productId,
      trigger: 'manual',
      queuedAt: now.toISOString(),
    });
    return queued?.id;
  }

  // A run stuck for good would block the product: written as failed before anything reads or inserts.
  private async expireStuck(workspaceId: string, productId: string, now: Date): Promise<void> {
    await this.deps.verdicts.failExpired(
      workspaceId,
      productId,
      now.toISOString(),
      new Date(now.getTime() - VERDICT_QUEUED_TTL_MS).toISOString(),
      VERDICT_EXPIRED,
    );
  }

  // A run that never reached the queue (or whose research row could not be recorded) would block the
  // product: failed before the error is reported.
  private async enqueue(
    workspaceId: string,
    run: SaleVerdict,
    trigger: VerdictTrigger,
    forceResearch: boolean,
    now: Date,
  ): Promise<void> {
    let researchRunId: string | undefined;
    if (forceResearch) {
      try {
        researchRunId = await this.queueResearch(workspaceId, run.productId, now);
      } catch (error) {
        await this.failEnqueued(run, trigger, error, 'enqueue_failed');
        throw error;
      }
      // A forced refresh with no research to run would be accepted for nothing.
      if (!researchRunId) {
        this.deps.logger?.warn?.({ productId: run.productId, runId: run.id, trigger }, 'Forced refresh refused: a research run is active');
        await this.deps.verdicts.fail(run.id, this.deps.now().toISOString(), 'research_active');
        throw new ConflictError(ANALYSIS_RUNNING);
      }
    }
    try {
      if (researchRunId) await this.deps.verdicts.setResearchRun(run.id, researchRunId);
      await this.deps.queue.enqueue({ workspaceId, productId: run.productId, runId: run.id, forceResearch, researchRunId });
    } catch (error) {
      if (researchRunId) {
        try {
          await this.failQueuedResearch(workspaceId, run.productId, researchRunId);
        } catch (cleanupError) {
          this.deps.logger?.error({ productId: run.productId, runId: run.id, err: cleanupError }, 'Finishing the queued research run failed');
        }
      }
      await this.failEnqueued(run, trigger, error, 'enqueue_failed');
      throw error;
    }
  }

  private async failEnqueued(run: SaleVerdict, trigger: VerdictTrigger, error: unknown, code: string): Promise<void> {
    this.deps.logger?.error({ productId: run.productId, runId: run.id, trigger, err: error }, 'Sale verdict run not queued');
    await this.deps.verdicts.fail(run.id, this.deps.now().toISOString(), code);
  }

  private async failQueuedResearch(workspaceId: string, productId: string, researchRunId: string): Promise<void> {
    const finishedAt = this.deps.now();
    const consecutiveFailures =
      ((await this.deps.researchRuns.findLastFinished(workspaceId, productId))?.consecutiveFailures ?? 0) + 1;
    await this.deps.researchRuns.finish(researchRunId, {
      outcome: 'failed',
      nodes: {},
      failedTiers: [],
      errorCode: 'enqueue_failed',
      consecutiveFailures,
      finishedAt: finishedAt.toISOString(),
      nextAutoAt: nextAutoAt('failed', consecutiveFailures, finishedAt).toISOString(),
    });
  }

  private async storeInfoVerdict(
    workspaceId: string,
    productId: string,
    listingId: string,
    result: ProductRecheckResult,
  ): Promise<void> {
    const [product, workspace, listing] = await Promise.all([
      this.deps.products.findByIdForWorkspace(productId, workspaceId),
      this.deps.workspaces.findById(workspaceId),
      this.deps.listings.findByIdForWorkspace(listingId, workspaceId),
    ]);
    if (!product || !workspace) throw new NotFoundError(`Product not found: ${productId}`);
    const marketplace = listing
      ? await this.deps.marketplaces.findByIdForWorkspace(listing.marketplaceId, workspaceId)
      : null;
    // The Recheck ran once already; the info check reads its result instead of repeating it.
    const info = await this.deps.infoCheckFor({ recheck: async () => result })({
      workspace,
      product,
      listing,
      marketplace,
      now: this.deps.now,
      options: { forceResearch: false, infoCodeOnly: true },
      signal: new AbortController().signal,
    });

    const now = this.deps.now().toISOString();
    const id = this.deps.newId();
    const queued = await this.deps.verdicts.insertQueued({
      id,
      workspaceId,
      productId,
      graphVersion: SALE_VERDICT_GRAPH_VERSION,
      scope: ['info'],
      queuedAt: now,
    });
    // A run holds the product: its own result will include the info check.
    if (!queued) return;
    // Claimed at once with a short lease, so a crash here frees the product when the lease ends.
    try {
      await this.deps.verdicts.claim(id, now, new Date(this.deps.now().getTime() + RECHECK_LEASE_MS).toISOString());
      await this.deps.verdicts.setListing(id, listingId);
      const previous = (await this.deps.verdicts.findLatestCompleted(workspaceId, productId))?.checks ?? {};
      const { checks, overall } = combineVerdict([info], previous);
      await this.deps.verdicts.complete(id, { checks, overall, completedAt: now });
    } catch (error) {
      await this.deps.verdicts.fail(id, this.deps.now().toISOString(), 'store_failed');
      throw error;
    }
  }
}
