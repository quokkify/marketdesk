import type { SaleVerdict } from '../../../../shared/types';
import type { ISaleVerdictRepository } from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import { SaleVerdictHandler } from '../JobHandlers/SaleVerdictHandler';

const JOB = { workspaceId: 'w1', productId: 'p1', runId: 'run-1', forceResearch: true };
const RUN = { id: 'run-1', scope: ['price'], status: 'running' } as unknown as SaleVerdict;

function setup(options: { claimed?: boolean; graph?: () => Promise<SaleVerdict> } = {}) {
  const failed: Array<{ runId: string; code: string }> = [];
  const inputs: unknown[] = [];
  const handler = new SaleVerdictHandler({
    verdicts: {
      claim: async () => (options.claimed === false ? null : RUN),
      fail: async (runId: string, _at: string, code: string) => {
        failed.push({ runId, code });
        return true;
      },
    } as unknown as ISaleVerdictRepository,
    graph: {
      run: async (input) => {
        inputs.push(input);
        return options.graph ? options.graph() : ({ ...RUN, status: 'completed' } as SaleVerdict);
      },
    },
    now: () => new Date('2026-11-22T12:00:00.000Z'),
    logger: { error: () => {} },
  });
  return { handler, failed, inputs };
}

describe('SaleVerdictHandler', () => {
  it('skips a run that is no longer queued without running the graph', async () => {
    const { handler, inputs } = setup({ claimed: false });

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'skipped' });
    expect(inputs).toHaveLength(0);
  });

  it('runs the graph with the run scope and forceResearch', async () => {
    const { handler, inputs } = setup();

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'finished', status: 'completed' });
    expect(inputs[0]).toMatchObject({ workspaceId: 'w1', productId: 'p1', runId: 'run-1', scope: ['price'], options: { forceResearch: true } });
  });

  it('fails the run with run_error when the graph throws, without rethrowing', async () => {
    const { handler, failed } = setup({ graph: async () => { throw new Error('boom'); } });

    await expect(handler.handle(JOB)).resolves.toEqual({ kind: 'finished', status: 'failed' });
    expect(failed).toEqual([{ runId: 'run-1', code: 'run_error' }]);
  });
});
