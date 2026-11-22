// Job handler: one sale verdict graph run per queued run. It claims the run by id (a run no longer
// queued is skipped), holds a 12 minute lease and runs the graph within a 10 minute budget (the
// research alone has 7). A throw fails the run with run_error. Every outcome completes the job
// (attempts: 1): a failure is recorded on the run, never retried by the queue.

import type { VerdictRunStatus } from '../../../../shared/types';
import type { ISaleVerdictRepository } from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type { SaleVerdictJob } from '../../../application/ports/IJobQueue';
import type { SaleVerdictGraph } from '../../../application/services/verdict/SaleVerdictGraph';

const LEASE_MS = 12 * 60 * 1000;
const RUN_BUDGET_MS = 10 * 60 * 1000;

export type SaleVerdictJobResult = { kind: 'skipped' } | { kind: 'finished'; status: VerdictRunStatus };

// Structural, so the container can pass its logger.
export interface SaleVerdictHandlerLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface SaleVerdictHandlerDeps {
  verdicts: ISaleVerdictRepository;
  graph: Pick<SaleVerdictGraph, 'run'>;
  now: () => Date;
  logger?: SaleVerdictHandlerLogger;
}

export class SaleVerdictHandler {
  constructor(private readonly deps: SaleVerdictHandlerDeps) {}

  async handle(job: SaleVerdictJob): Promise<SaleVerdictJobResult> {
    const started = this.deps.now();
    const run = await this.deps.verdicts.claim(
      job.runId,
      started.toISOString(),
      new Date(started.getTime() + LEASE_MS).toISOString(),
    );
    if (!run) return { kind: 'skipped' };

    try {
      const verdict = await this.deps.graph.run({
        workspaceId: job.workspaceId,
        productId: job.productId,
        runId: job.runId,
        scope: run.scope,
        options: { forceResearch: job.forceResearch, researchRunId: job.researchRunId },
        signal: AbortSignal.timeout(RUN_BUDGET_MS),
      });
      return { kind: 'finished', status: verdict.status };
    } catch (error) {
      this.deps.logger?.error({ productId: job.productId, runId: job.runId, err: error }, 'Sale verdict run failed');
      await this.deps.verdicts.fail(job.runId, this.deps.now().toISOString(), 'run_error');
      return { kind: 'finished', status: 'failed' };
    }
  }
}
