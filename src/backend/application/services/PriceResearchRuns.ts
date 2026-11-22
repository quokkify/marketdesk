// Starts price research runs. A request checks the product and the setup, then records a queued run
// and enqueues its ids; the graph runs only in the price-research job. A product has at most one
// queued or running run: a running run whose lease ended, or a run queued longer than the queued TTL
// (its job was lost), is written as a failed run and frees it. Such a run never reaches the job's
// re-estimate, so the reader that wrote the expiry starts onExpired without waiting for it.

import type { ResearchRun, RunTrigger } from '../../../shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IPriceResearchRunRepository } from '../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { IPriceResearchRepository } from '../../domain/repositories/interfaces/IPriceResearchRepository';
import type { IPriceResearchRuns, RunRequestReason } from '../../domain/ports/IPriceResearchRuns';
import { NotFoundError, TooManyRequestsError } from '../../domain/shared/DomainError';
import { nextAutoAt, researchDue } from '../../domain/services/researchSchedule';
import type { IJobQueue, PriceResearchJob } from '../ports/IJobQueue';
import { SEARCH_CURRENCY } from './PriceResearchGraph';

export const MAX_QUEUED_RUNS_PER_WORKSPACE = 10;
export const QUEUED_TTL_MS = 60 * 60 * 1000;
const TOO_MANY_QUEUED = 'Too many price research runs are queued in this workspace. Try again later.';

// Structural, so the container can pass its logger.
export interface PriceResearchRunsLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface PriceResearchRunsDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct'>;
  runs: IPriceResearchRunRepository;
  // Read only for a product with no runs yet: its last research attempt from before runs existed.
  research: Pick<IPriceResearchRepository, 'findByProduct'>;
  queue: IJobQueue<PriceResearchJob>;
  // Whether a research profile is configured.
  configured: boolean;
  newId: () => string;
  now: () => Date;
  // The re-estimate after a run finished by its expiry; a failure is logged.
  onExpired?: (workspaceId: string, productId: string) => Promise<unknown>;
  logger?: PriceResearchRunsLogger;
}

type RequestResult = { run: ResearchRun | null; enqueued: boolean; reason: RunRequestReason };

export class PriceResearchRuns implements IPriceResearchRuns {
  constructor(private readonly deps: PriceResearchRunsDeps) {}

  async request(
    workspaceId: string,
    productId: string,
    opts: { force: boolean; trigger: RunTrigger },
  ): Promise<RequestResult> {
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
    if (!this.deps.configured) return { run: null, enqueued: false, reason: 'not_configured' };
    const listing = (await this.deps.listings.findByProduct(product.id))[0];
    if (!listing || listing.price.currency !== SEARCH_CURRENCY) return { run: null, enqueued: false, reason: 'not_pln' };

    const now = this.deps.now();
    const { active, last } = await this.current(workspaceId, productId, now);
    if (active) return { run: active, enqueued: false, reason: 'active' };
    if (!opts.force) {
      // Read only for a product with no runs yet.
      const lastAttemptAt = last ? null : (await this.deps.research.findByProduct(workspaceId, productId))?.lastAttemptAt;
      if (!researchDue(last, lastAttemptAt, now)) return { run: last, enqueued: false, reason: 'not_due' };
    }
    const queuedSince = new Date(now.getTime() - QUEUED_TTL_MS).toISOString();
    if (await this.deps.runs.countQueued(workspaceId, queuedSince) >= MAX_QUEUED_RUNS_PER_WORKSPACE) {
      throw new TooManyRequestsError(TOO_MANY_QUEUED);
    }

    const run = await this.deps.runs.insertQueued({
      id: this.deps.newId(),
      workspaceId,
      productId,
      trigger: opts.trigger,
      queuedAt: now.toISOString(),
    });
    // A concurrent request queued a run first.
    if (!run) return { run: await this.deps.runs.findActive(workspaceId, productId), enqueued: false, reason: 'active' };
    await this.enqueue(run, last);
    return { run, enqueued: true, reason: 'enqueued' };
  }

  async latest(workspaceId: string, productId: string): Promise<{ active: ResearchRun | null; last: ResearchRun | null }> {
    return this.current(workspaceId, productId, this.deps.now());
  }

  private async current(
    workspaceId: string,
    productId: string,
    now: Date,
  ): Promise<{ active: ResearchRun | null; last: ResearchRun | null }> {
    const active = await this.deps.runs.findActive(workspaceId, productId);
    const last = await this.deps.runs.findLastFinished(workspaceId, productId);
    const expiredCode = active ? expiryCode(active, now) : null;
    if (!active || !expiredCode) return { active, last };

    const consecutiveFailures = (last?.consecutiveFailures ?? 0) + 1;
    const expired = {
      outcome: 'failed' as const,
      nodes: active.nodes,
      failedTiers: [],
      errorCode: expiredCode,
      consecutiveFailures,
      finishedAt: now.toISOString(),
      nextAutoAt: nextAutoAt('failed', consecutiveFailures, now).toISOString(),
    };
    if (await this.deps.runs.finish(active.id, expired)) this.afterExpiry(active);
    return {
      active: null,
      last: (await this.deps.runs.findLastFinished(workspaceId, productId)) ?? { ...active, ...expired, status: 'finished', leaseUntil: null },
    };
  }

  private afterExpiry(run: ResearchRun): void {
    if (!this.deps.onExpired) return;
    this.deps.onExpired(run.workspaceId, run.productId).catch((error: unknown) => {
      this.deps.logger?.error(
        { productId: run.productId, runId: run.id, err: error },
        'Re-estimating after an expired price research run failed',
      );
    });
  }

  // A run that never reached the queue would block the product: finish it before reporting the error.
  private async enqueue(run: ResearchRun, last: ResearchRun | null): Promise<void> {
    try {
      await this.deps.queue.enqueue({ workspaceId: run.workspaceId, productId: run.productId, runId: run.id });
    } catch (error) {
      this.deps.logger?.error({ productId: run.productId, runId: run.id, err: error }, 'Price research run not queued');
      const finishedAt = this.deps.now();
      const consecutiveFailures = (last?.consecutiveFailures ?? 0) + 1;
      await this.deps.runs.finish(run.id, {
        outcome: 'failed',
        nodes: {},
        failedTiers: [],
        errorCode: 'enqueue_failed',
        consecutiveFailures,
        finishedAt: finishedAt.toISOString(),
        nextAutoAt: nextAutoAt('failed', consecutiveFailures, finishedAt).toISOString(),
      });
      throw error;
    }
  }
}

// Why an active run no longer holds its product, or null while it does.
function expiryCode(run: ResearchRun, now: Date): 'lease_expired' | 'job_lost' | null {
  if (run.status === 'running' && run.leaseUntil !== null && Date.parse(run.leaseUntil) < now.getTime()) return 'lease_expired';
  if (run.status === 'queued' && Date.parse(run.queuedAt) < now.getTime() - QUEUED_TTL_MS) return 'job_lost';
  return null;
}
