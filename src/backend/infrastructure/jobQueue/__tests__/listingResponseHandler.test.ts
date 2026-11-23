import type { ListingResponseRun } from '../../../../shared/types';
import type { IListingResponseRunRepository } from '../../../domain/repositories/interfaces/IListingResponseRunRepository';
import { InvalidStateError, NotFoundError } from '../../../domain/shared/DomainError';
import { ListingResponseHandler } from '../JobHandlers/ListingResponseHandler';

const JOB = { workspaceId: 'w1', productId: 'p1', runId: 'run-1' };
const RUN = { id: 'run-1', status: 'running' } as unknown as ListingResponseRun;

function setup(options: { claimed?: boolean; graph?: () => Promise<ListingResponseRun> } = {}) {
  const failed: Array<{ runId: string; code: string }> = [];
  const inputs: unknown[] = [];
  const logged: Array<Record<string, unknown>> = [];
  const handler = new ListingResponseHandler({
    runs: {
      claim: async () => (options.claimed === false ? null : RUN),
      fail: async (runId: string, _at: string, code: string) => {
        failed.push({ runId, code });
        return true;
      },
    } as unknown as IListingResponseRunRepository,
    graph: {
      run: async (input) => {
        inputs.push(input);
        return options.graph ? options.graph() : ({ ...RUN, status: 'completed' } as ListingResponseRun);
      },
    },
    now: () => new Date('2026-11-23T12:00:00.000Z'),
    logger: { error: (context) => logged.push(context) },
  });
  return { handler, failed, inputs, logged };
}

describe('ListingResponseHandler', () => {
  it('skips a run that is no longer queued without running the graph', async () => {
    const { handler, inputs } = setup({ claimed: false });

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'skipped' });
    expect(inputs).toHaveLength(0);
  });

  it('runs the graph with the job ids', async () => {
    const { handler, inputs } = setup();

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'finished', status: 'completed' });
    expect(inputs[0]).toMatchObject(JOB);
  });

  it('fails the run with run_error when the graph throws, without rethrowing', async () => {
    const { handler, failed } = setup({ graph: async () => { throw new Error('boom'); } });

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'finished', status: 'failed' });
    expect(failed).toEqual([{ runId: 'run-1', code: 'run_error' }]);
  });

  it('logs the error name only, never its message', async () => {
    const { handler, logged } = setup({ graph: async () => { throw new TypeError('secret detail'); } });

    await handler.handle(JOB);

    expect(logged).toEqual([{ productId: 'p1', runId: 'run-1', errorName: 'TypeError' }]);
  });

  it.each([new InvalidStateError('no listing'), new NotFoundError('no product')])(
    'fails the run with not_applicable on %s',
    async (error) => {
      const { handler, failed } = setup({ graph: async () => { throw error; } });

      await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'finished', status: 'failed' });
      expect(failed).toEqual([{ runId: 'run-1', code: 'not_applicable' }]);
    },
  );
});
