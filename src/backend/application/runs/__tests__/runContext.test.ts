import { currentRun, runInContext } from '../runContext';
import { noopRunRecorder } from '../../ports/IRunRecorder';

describe('runContext', () => {
  it('keeps the run across awaits and isolates parallel runs', async () => {
    const seen: string[] = [];
    await Promise.all(
      ['a', 'b'].map((runId) =>
        runInContext({ runId, kind: 'http' }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(currentRun()!.runId);
        }),
      ),
    );
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(currentRun()).toBeUndefined();
  });

  it('the no-op recorder is disabled and never throws', () => {
    expect(noopRunRecorder.enabled).toBe(false);
    expect(() => noopRunRecorder.record('r', { type: 'run.start', kind: 'http' })).not.toThrow();
    expect(() => noopRunRecorder.discard('r')).not.toThrow();
  });
});
