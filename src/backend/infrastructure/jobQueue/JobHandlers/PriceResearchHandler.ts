// Job handler: one price research graph run per queued run. It claims the run by id (a job whose run
// is no longer queued exits without calling Hermes), holds a 10 minute lease, runs the graph within a
// 7 minute budget while recording node progress, and finishes the run with its outcome and the next
// automatic run time. Then afterRun (the re-estimate) runs for every finished run, with no result when
// the graph threw or timed out, and price_research.completed is published.
// Every outcome completes the job (attempts: 1): a failure is recorded on the run, never retried by
// the queue.

import type { ResearchRun, RunOutcome } from '../../../../shared/types';
import type { IPriceResearchRunRepository } from '../../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { PriceResearchJob } from '../../../application/ports/IJobQueue';
import {
  SEARCH_NEEDS_PLN,
  SEARCH_NOT_CONFIGURED,
  type GraphResult,
  type PriceResearchGraph,
} from '../../../application/services/PriceResearchGraph';
import { SEARCH_NAME_TOO_SHORT } from '../../external/anchorLadderPrompt';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../../domain/shared/DomainError';
import { nextAutoAt, RECHECK_WAIT_MS } from '../../../domain/services/researchSchedule';

const RUN_BUDGET_MS = 7 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;

// Refusals that mean the research could not be attempted: they schedule nothing and count no failure.
const NOT_ATTEMPTED = new Set(['product_missing', 'not_configured', 'not_pln']);

export type PriceResearchJobResult = { kind: 'skipped' } | { kind: 'finished'; outcome: RunOutcome };

// Structural, so the container can pass its logger.
export interface PriceResearchHandlerLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface PriceResearchHandlerDeps {
  runs: IPriceResearchRunRepository;
  graph: Pick<PriceResearchGraph, 'run'>;
  afterRun: (workspaceId: string, productId: string, result: GraphResult | null) => Promise<void>;
  events: IEventPublisher;
  now: () => Date;
  logger?: PriceResearchHandlerLogger;
}

function refusalCode(error: unknown): string {
  if (error instanceof NotFoundError) return 'product_missing';
  if (error instanceof ServiceUnavailableError && error.message === SEARCH_NOT_CONFIGURED) return 'not_configured';
  if (error instanceof ValidationError && error.message === SEARCH_NEEDS_PLN) return 'not_pln';
  if (error instanceof ValidationError && error.message === SEARCH_NAME_TOO_SHORT) return 'name_too_short';
  return 'run_error';
}

export class PriceResearchHandler {
  constructor(private readonly deps: PriceResearchHandlerDeps) {}

  async handle(job: PriceResearchJob): Promise<PriceResearchJobResult> {
    const started = this.deps.now();
    const run = await this.deps.runs.claim(
      job.runId,
      started.toISOString(),
      new Date(started.getTime() + LEASE_MS).toISOString(),
    );
    if (!run) return { kind: 'skipped' };

    let result: GraphResult | null = null;
    let errorCode: string | null;
    try {
      result = await this.deps.graph.run({
        workspaceId: run.workspaceId,
        productId: run.productId,
        signal: AbortSignal.timeout(RUN_BUDGET_MS),
        onNode: (node, status) => this.deps.runs.saveNode(run.id, node, status),
      });
      errorCode = result.errorCode;
    } catch (error) {
      errorCode = refusalCode(error);
      if (errorCode === 'run_error') {
        this.deps.logger?.error({ productId: run.productId, runId: run.id, err: error }, 'Price research run failed');
      }
    }

    const outcome = result?.outcome ?? 'failed';
    await this.finish(run, outcome, result, errorCode);
    await this.afterRun(run, result);
    await this.deps.events.publish({
      type: 'price_research.completed',
      aggregateType: 'product',
      aggregateId: run.productId,
      payload: { runId: run.id, outcome },
      occurredAt: this.deps.now(),
    });
    return { kind: 'finished', outcome };
  }

  private async finish(run: ResearchRun, outcome: RunOutcome, result: GraphResult | null, errorCode: string | null): Promise<void> {
    const finished = this.deps.now();
    const previous = (await this.deps.runs.findLastFinished(run.workspaceId, run.productId))?.consecutiveFailures ?? 0;
    const attempted = !(errorCode && NOT_ATTEMPTED.has(errorCode));
    const consecutiveFailures = !attempted ? previous : outcome === 'failed' ? previous + 1 : 0;
    await this.deps.runs.finish(run.id, {
      outcome,
      nodes: result?.nodes ?? run.nodes,
      failedTiers: result?.failedTiers ?? [],
      errorCode,
      consecutiveFailures,
      finishedAt: finished.toISOString(),
      // A name with nothing to search will not change by itself: retried only after the recheck wait.
      nextAutoAt: !attempted
        ? null
        : errorCode === 'name_too_short'
          ? new Date(finished.getTime() + RECHECK_WAIT_MS).toISOString()
          : nextAutoAt(outcome, consecutiveFailures, finished).toISOString(),
    });
  }

  // The research is stored already; a failed re-estimate must not lose the completion event.
  private async afterRun(run: ResearchRun, result: GraphResult | null): Promise<void> {
    try {
      await this.deps.afterRun(run.workspaceId, run.productId, result);
    } catch (error) {
      this.deps.logger?.error({ productId: run.productId, runId: run.id, err: error }, 'Re-estimating after price research failed');
    }
  }
}
