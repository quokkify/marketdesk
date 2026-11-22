// Reads price research runs. The runs are written by the sale verdict's price check (see
// recordedResearchRun). A product has at most one queued or running run: a running run whose lease
// ended, or a run queued longer than the queued TTL (its job was lost), is written as a failed run
// by the reader that finds it, and frees the product.

import type { ResearchRun } from '../../../shared/types';
import type { IPriceResearchRunRepository } from '../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { IPriceResearchRuns } from '../../domain/ports/IPriceResearchRuns';
import { nextAutoAt } from '../../domain/services/researchSchedule';

export const QUEUED_TTL_MS = 60 * 60 * 1000;

export interface PriceResearchRunsDeps {
  runs: IPriceResearchRunRepository;
  now: () => Date;
}

export class PriceResearchRuns implements IPriceResearchRuns {
  constructor(private readonly deps: PriceResearchRunsDeps) {}

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
    await this.deps.runs.finish(active.id, expired);
    return {
      active: null,
      last: (await this.deps.runs.findLastFinished(workspaceId, productId)) ?? { ...active, ...expired, status: 'finished', leaseUntil: null },
    };
  }
}

// Why an active run no longer holds its product, or null while it does.
function expiryCode(run: ResearchRun, now: Date): 'lease_expired' | 'job_lost' | null {
  if (run.status === 'running' && run.leaseUntil !== null && Date.parse(run.leaseUntil) < now.getTime()) return 'lease_expired';
  if (run.status === 'queued' && Date.parse(run.queuedAt) < now.getTime() - QUEUED_TTL_MS) return 'job_lost';
  return null;
}
