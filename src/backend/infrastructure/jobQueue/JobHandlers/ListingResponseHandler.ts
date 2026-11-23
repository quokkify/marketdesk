// Job handler: one listing response graph run per queued run. It claims the run by id (a run no
// longer queued is skipped), holds a 5 minute lease and runs the graph within a 4 minute budget. A
// product or listing the graph cannot work on fails the run with not_applicable, any other throw
// with run_error. Every outcome completes the job (attempts: 1): a failure is recorded on the run,
// never retried by the queue.

import type { VerdictRunStatus } from '../../../../shared/types';
import type { IListingResponseRunRepository } from '../../../domain/repositories/interfaces/IListingResponseRunRepository';
import { InvalidStateError, NotFoundError } from '../../../domain/shared/DomainError';
import type { ListingResponseJob } from '../../../application/ports/IJobQueue';
import type { ListingResponseGraph } from '../../../application/services/response/ListingResponseGraph';

const LEASE_MS = 5 * 60 * 1000;
const RUN_BUDGET_MS = 4 * 60 * 1000;

export type ListingResponseJobResult = { kind: 'skipped' } | { kind: 'finished'; status: VerdictRunStatus };

// Structural, so the container can pass its logger.
export interface ListingResponseHandlerLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface ListingResponseHandlerDeps {
  runs: IListingResponseRunRepository;
  graph: Pick<ListingResponseGraph, 'run'>;
  now: () => Date;
  logger?: ListingResponseHandlerLogger;
}

export class ListingResponseHandler {
  constructor(private readonly deps: ListingResponseHandlerDeps) {}

  async handle(job: ListingResponseJob): Promise<ListingResponseJobResult> {
    const started = this.deps.now();
    const run = await this.deps.runs.claim(
      job.runId,
      started.toISOString(),
      new Date(started.getTime() + LEASE_MS).toISOString(),
    );
    if (!run) return { kind: 'skipped' };

    try {
      const result = await this.deps.graph.run({
        workspaceId: job.workspaceId,
        productId: job.productId,
        runId: job.runId,
        signal: AbortSignal.timeout(RUN_BUDGET_MS),
      });
      return { kind: 'finished', status: result.status };
    } catch (error) {
      const notApplicable = error instanceof InvalidStateError || error instanceof NotFoundError;
      this.deps.logger?.error(
        { productId: job.productId, runId: job.runId, errorName: error instanceof Error ? error.name : 'unknown' },
        'Listing response run failed',
      );
      await this.deps.runs.fail(job.runId, this.deps.now().toISOString(), notApplicable ? 'not_applicable' : 'run_error');
      return { kind: 'finished', status: 'failed' };
    }
  }
}
