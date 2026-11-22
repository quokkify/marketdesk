// One price research graph run recorded in price_research_runs: it claims the run by id (a run no
// longer queued is skipped without calling Hermes), holds a 10 minute lease, runs the graph within
// the caller's budget while recording node progress, then runs beforeFinish while the run is still
// active, so a client polling the run sees it end only once that step is done. Then it finishes the
// run with its outcome and the next automatic run time and, when that finish was written, publishes
// price_research.completed. Shared by the research job and the research
// node of the sale verdict's price check.

import type { ResearchRun, RunOutcome, RunTrigger } from '../../../shared/types';
import type { IPriceResearchRunRepository } from '../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { IEventPublisher } from '../../domain/ports/IEventPublisher';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../domain/shared/DomainError';
import { nextAutoAt, RECHECK_WAIT_MS } from '../../domain/services/researchSchedule';
import { SEARCH_NAME_TOO_SHORT } from '../../infrastructure/external/anchorLadderPrompt';
import { SEARCH_NEEDS_PLN, SEARCH_NOT_CONFIGURED, type GraphResult, type PriceResearchGraph } from './PriceResearchGraph';

const LEASE_MS = 10 * 60 * 1000;

// Refusals that mean the research could not be attempted: they schedule nothing and count no failure.
const NOT_ATTEMPTED = new Set(['product_missing', 'not_configured', 'not_pln']);

// Structural, so the container can pass its logger.
export interface RecordedResearchRunLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface RecordedResearchRunDeps {
  runs: IPriceResearchRunRepository;
  graph: Pick<PriceResearchGraph, 'run'>;
  events: IEventPublisher;
  now: () => Date;
  logger?: RecordedResearchRunLogger;
}

export type RecordedRun =
  | { kind: 'skipped' }
  | {
      kind: 'finished';
      run: ResearchRun;
      outcome: RunOutcome;
      // Null when the graph threw or refused.
      result: GraphResult | null;
      errorCode: string | null;
      // False when the run had already finished (e.g. its expired lease was written by a read).
      written: boolean;
    };

function refusalCode(error: unknown): string {
  if (error instanceof NotFoundError) return 'product_missing';
  if (error instanceof ServiceUnavailableError && error.message === SEARCH_NOT_CONFIGURED) return 'not_configured';
  if (error instanceof ValidationError && error.message === SEARCH_NEEDS_PLN) return 'not_pln';
  if (error instanceof ValidationError && error.message === SEARCH_NAME_TOO_SHORT) return 'name_too_short';
  return 'run_error';
}

export class RecordedResearchRun {
  constructor(private readonly deps: RecordedResearchRunDeps) {}

  // Executes the run queued at request time when there is one still queued; otherwise records a new
  // queued run and executes it at once ('active' when the product already has a queued or running run).
  async start(
    run: { id: string; workspaceId: string; productId: string; trigger: RunTrigger },
    signal: AbortSignal,
    queuedRunId?: string,
    // Called with the id of a run recorded here, before it executes.
    onQueued?: (runId: string) => Promise<void>,
  ): Promise<RecordedRun | { kind: 'active' }> {
    if (queuedRunId) {
      const claimed = await this.execute(queuedRunId, signal);
      if (claimed.kind !== 'skipped') return claimed;
    }
    const queued = await this.deps.runs.insertQueued({ ...run, queuedAt: this.deps.now().toISOString() });
    if (!queued) return { kind: 'active' };
    // The link is only a hint for readers: a failure to write it must not strand the queued run.
    try {
      await onQueued?.(queued.id);
    } catch (error) {
      this.deps.logger?.error({ productId: run.productId, runId: queued.id, err: error }, 'Linking the research run failed');
    }
    return this.execute(queued.id, signal);
  }

  async execute(
    runId: string,
    signal: AbortSignal,
    beforeFinish?: (run: ResearchRun, result: GraphResult | null) => Promise<void>,
  ): Promise<RecordedRun> {
    const started = this.deps.now();
    const run = await this.deps.runs.claim(
      runId,
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
        signal,
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
    if (beforeFinish) await beforeFinish(run, result);
    const written = await this.finish(run, outcome, result, errorCode);
    // Only a finish that was written: a run already expired by a read keeps its stored outcome.
    if (written) {
      await this.deps.events.publish({
        type: 'price_research.completed',
        aggregateType: 'product',
        aggregateId: run.productId,
        payload: { runId: run.id, outcome },
        occurredAt: this.deps.now(),
      });
    }
    return { kind: 'finished', run, outcome, result, errorCode, written };
  }

  private async finish(run: ResearchRun, outcome: RunOutcome, result: GraphResult | null, errorCode: string | null): Promise<boolean> {
    const finished = this.deps.now();
    const previous = (await this.deps.runs.findLastFinished(run.workspaceId, run.productId))?.consecutiveFailures ?? 0;
    const attempted = !(errorCode && NOT_ATTEMPTED.has(errorCode));
    const consecutiveFailures = !attempted ? previous : outcome === 'failed' ? previous + 1 : 0;
    return this.deps.runs.finish(run.id, {
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
}
