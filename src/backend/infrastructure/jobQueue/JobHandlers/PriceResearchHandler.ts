// Job handler: one price research graph run per queued run, recorded by RecordedResearchRun (claim,
// 10 minute lease, node progress, finish with the next automatic run time) within a 7 minute budget.
// Before the finish it runs afterRun (the re-estimate; no result when the graph threw or timed out)
// while the run is still active, so a client polling the run sees it end only once the estimate is
// stored. RecordedResearchRun publishes price_research.completed when that finish was written.
// Every outcome completes the job (attempts: 1): a failure is recorded on the run, never retried by
// the queue.

import type { ResearchRun, RunOutcome } from '../../../../shared/types';
import type { IPriceResearchRunRepository } from '../../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { PriceResearchJob } from '../../../application/ports/IJobQueue';
import type { GraphResult, PriceResearchGraph } from '../../../application/services/PriceResearchGraph';
import { RecordedResearchRun } from '../../../application/services/recordedResearchRun';

const RUN_BUDGET_MS = 7 * 60 * 1000;

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

export class PriceResearchHandler {
  private readonly recorded: RecordedResearchRun;

  constructor(private readonly deps: PriceResearchHandlerDeps) {
    this.recorded = new RecordedResearchRun({
      runs: deps.runs,
      graph: deps.graph,
      events: deps.events,
      now: deps.now,
      logger: deps.logger,
    });
  }

  async handle(job: PriceResearchJob): Promise<PriceResearchJobResult> {
    const recorded = await this.recorded.execute(
      job.runId,
      AbortSignal.timeout(RUN_BUDGET_MS),
      (run, result) => this.afterRun(run, result),
    );
    if (recorded.kind === 'skipped') return { kind: 'skipped' };
    return { kind: 'finished', outcome: recorded.outcome };
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
