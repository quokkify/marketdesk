import {
  InMemoryPriceResearchRunRepository,
  RecordingEventPublisher,
} from '../../../domain/testkit/support';
import { ValidationError } from '../../../domain/shared/DomainError';
import type { ResearchRun } from '../../../../shared/types';
import type { GraphResult, ResearchRunInput } from '../../../application/services/PriceResearchGraph';
import { PriceResearchHandler } from '../JobHandlers/PriceResearchHandler';
import { SEARCH_NAME_TOO_SHORT } from '../../external/anchorLadderPrompt';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const job = { workspaceId: WS, productId: PID, runId: 'run-1' };

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function run(fields: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'run-1', workspaceId: WS, productId: PID, trigger: 'manual', status: 'queued', nodes: {},
    outcome: null, failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: at(-60 * 1000),
    startedAt: null, finishedAt: null, leaseUntil: null, nextAutoAt: null,
    ...fields,
  };
}

const OK_RESULT: GraphResult = {
  outcome: 'ok',
  nodes: { identify: 'done', sameModelUsed: 'done', lastNewPrice: 'done', substitutesNew: 'done', substitutesUsed: 'done' },
  failedTiers: [],
  errorCode: null,
  research: null,
  rowsChanged: true,
};

class Logger {
  readonly errors: Array<{ context: Record<string, unknown>; message: string }> = [];
  warn(): void {}
  error(context: Record<string, unknown>, message: string): void {
    this.errors.push({ context, message });
  }
}

function setup(options: {
  graph?: (input: ResearchRunInput) => Promise<GraphResult>;
  runs?: InMemoryPriceResearchRunRepository;
  afterRun?: () => Promise<void>;
} = {}) {
  const runs = options.runs ?? new InMemoryPriceResearchRunRepository();
  if (!options.runs) runs.runs.push(run({}));
  const events = new RecordingEventPublisher();
  const logger = new Logger();
  const order: string[] = [];
  const inputs: ResearchRunInput[] = [];
  const afterRunResults: Array<GraphResult | null> = [];
  const graphRun = options.graph ?? (async () => OK_RESULT);
  const handler = new PriceResearchHandler({
    runs,
    graph: {
      run: async (input) => {
        inputs.push(input);
        return graphRun(input);
      },
    },
    afterRun: async (_workspaceId, _productId, result) => {
      order.push('afterRun');
      afterRunResults.push(result);
      await options.afterRun?.();
    },
    events: {
      publish: async (event) => {
        order.push('event');
        await events.publish(event);
      },
    },
    now: () => NOW,
    logger,
  });
  return { handler, runs, events, logger, order, inputs, afterRunResults };
}

describe('PriceResearchHandler', () => {
  it('exits without calling the graph when the run is no longer queued', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(run({ status: 'finished', outcome: 'ok' }));
    const { handler, inputs, events } = setup({ runs });

    await expect(handler.handle(job)).resolves.toEqual({ kind: 'skipped' });
    expect(inputs).toHaveLength(0);
    expect(events.published).toHaveLength(0);
  });

  it('claims the run with a 10 minute lease and records node progress while the graph runs', async () => {
    const seen: Array<ResearchRun | undefined> = [];
    const { handler, runs, inputs } = setup({
      graph: async (input) => {
        await input.onNode('identify', 'running');
        seen.push({ ...runs.runs[0]! });
        return OK_RESULT;
      },
    });

    await handler.handle(job);

    expect(inputs[0]).toMatchObject({ workspaceId: WS, productId: PID });
    expect(inputs[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]).toMatchObject({ status: 'running', startedAt: NOW.toISOString(), leaseUntil: at(10 * 60 * 1000), nodes: { identify: 'running' } });
  });

  it('finishes an ok run with the next automatic run in 7 days', async () => {
    const { handler, runs } = setup();

    await expect(handler.handle(job)).resolves.toEqual({ kind: 'finished', outcome: 'ok' });

    expect(runs.runs[0]).toMatchObject({
      status: 'finished', outcome: 'ok', nodes: OK_RESULT.nodes, failedTiers: [], errorCode: null,
      consecutiveFailures: 0, finishedAt: NOW.toISOString(), nextAutoAt: at(7 * 24 * HOUR_MS), leaseUntil: null,
    });
  });

  it('counts a failed run after earlier failures and backs off', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(run({ id: 'prev', status: 'finished', outcome: 'failed', consecutiveFailures: 1, finishedAt: at(-2 * HOUR_MS) }));
    runs.runs.push(run({}));
    const { handler } = setup({
      runs,
      graph: async () => ({
        ...OK_RESULT, outcome: 'failed', errorCode: 'all_tiers_failed', rowsChanged: false,
        failedTiers: ['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used'],
      }),
    });

    await handler.handle(job);

    expect(runs.runs[1]).toMatchObject({
      outcome: 'failed', errorCode: 'all_tiers_failed', consecutiveFailures: 2, nextAutoAt: at(2 * HOUR_MS),
      failedTiers: ['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used'],
    });
  });

  it('records an unsafe toolset as a counted failure with backoff', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(run({ id: 'prev', status: 'finished', outcome: 'failed', consecutiveFailures: 2, finishedAt: at(-2 * HOUR_MS) }));
    runs.runs.push(run({}));
    const { handler } = setup({
      runs,
      graph: async () => ({ ...OK_RESULT, outcome: 'failed', errorCode: 'unsafe_toolset', rowsChanged: false }),
    });

    await handler.handle(job);

    expect(runs.runs[1]).toMatchObject({ outcome: 'failed', errorCode: 'unsafe_toolset', consecutiveFailures: 3, nextAutoAt: at(4 * HOUR_MS) });
  });

  it('calls afterRun with the result, then publishes price_research.completed', async () => {
    const { handler, events, order } = setup();

    await handler.handle(job);

    expect(order).toEqual(['afterRun', 'event']);
    expect(events.published).toEqual([{
      type: 'price_research.completed',
      aggregateType: 'product',
      aggregateId: PID,
      payload: { runId: 'run-1', outcome: 'ok' },
      occurredAt: NOW,
    }]);
  });

  it('still publishes the event when afterRun fails, and logs the failure', async () => {
    const { handler, events, logger } = setup({ afterRun: async () => { throw new Error('estimate failed'); } });

    await handler.handle(job);

    expect(events.published).toHaveLength(1);
    expect(logger.errors.map((e) => e.message)).toEqual(['Re-estimating after price research failed']);
  });

  it('finishes the run as failed when the graph refuses before any call', async () => {
    const { handler, runs, events } = setup({
      graph: async () => { throw new ValidationError('OLX search needs a PLN listing'); },
    });

    await expect(handler.handle(job)).resolves.toEqual({ kind: 'finished', outcome: 'failed' });

    expect(runs.runs[0]).toMatchObject({ status: 'finished', outcome: 'failed', errorCode: 'not_pln', nextAutoAt: null, consecutiveFailures: 0 });
    expect(events.published[0]).toMatchObject({ payload: { runId: 'run-1', outcome: 'failed' } });
  });

  it('records a name with nothing to search as a failure retried in 7 days', async () => {
    const { handler, runs } = setup({
      graph: async () => { throw new ValidationError(SEARCH_NAME_TOO_SHORT); },
    });

    await handler.handle(job);

    expect(runs.runs[0]).toMatchObject({
      status: 'finished', outcome: 'failed', errorCode: 'name_too_short', consecutiveFailures: 1, nextAutoAt: at(7 * 24 * HOUR_MS),
    });
  });

  it('finishes the run as failed and logs an unexpected graph error', async () => {
    const { handler, runs, logger } = setup({ graph: async () => { throw new Error('db gone'); } });

    await handler.handle(job);

    expect(runs.runs[0]).toMatchObject({ status: 'finished', outcome: 'failed', errorCode: 'run_error', consecutiveFailures: 1, nextAutoAt: at(HOUR_MS) });
    expect(logger.errors.map((e) => e.message)).toEqual(['Price research run failed']);
  });

  it('calls afterRun without a result when the graph throws or times out, so the stored research is re-estimated', async () => {
    const { handler, order, afterRunResults } = setup({
      graph: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    });

    await handler.handle(job);

    expect(afterRunResults).toEqual([null]);
    expect(order).toEqual(['afterRun', 'event']);
  });

  it('does not call afterRun for a run it could not claim', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(run({ status: 'finished', outcome: 'ok' }));
    const { handler, afterRunResults } = setup({ runs });

    await expect(handler.handle(job)).resolves.toEqual({ kind: 'skipped' });

    expect(afterRunResults).toEqual([]);
  });
});
