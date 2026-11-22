import { createResearchCallLimiter } from '../researchCallLimiter';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createResearchCallLimiter', () => {
  it('runs at most max calls at once and starts a waiting call when one ends', async () => {
    const limiter = createResearchCallLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const runs = gates.map((gate, index) => limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(index);
      await gate.promise;
      active -= 1;
      return index;
    }));
    await new Promise((r) => setImmediate(r));
    expect(started).toEqual([0, 1]);
    gates[0].resolve();
    await runs[0];
    await new Promise((r) => setImmediate(r));
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve();
    gates[2].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(peak).toBe(2);
  });

  it('frees the slot when a call fails', async () => {
    const limiter = createResearchCallLimiter(1);
    await expect(limiter.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });

  it('refuses a max below one', () => {
    expect(() => createResearchCallLimiter(0)).toThrow();
  });
});
