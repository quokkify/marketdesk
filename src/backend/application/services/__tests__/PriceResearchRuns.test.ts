import { InMemoryPriceResearchRunRepository } from '../../../domain/testkit/support';
import type { ResearchRun } from '../../../../shared/types';
import { PriceResearchRuns } from '../PriceResearchRuns';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function storedRun(fields: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'old', workspaceId: WS, productId: PID, trigger: 'manual', status: 'finished', nodes: {},
    outcome: 'ok', failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: at(-2 * HOUR_MS),
    startedAt: at(-2 * HOUR_MS), finishedAt: at(-HOUR_MS), leaseUntil: null, nextAutoAt: null,
    ...fields,
  };
}

function setup(runs: InMemoryPriceResearchRunRepository) {
  return new PriceResearchRuns({ runs, now: () => NOW });
}

describe('PriceResearchRuns.latest', () => {
  it('returns the active and the last finished run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'done' }));
    runs.runs.push(storedRun({ id: 'now', status: 'queued', outcome: null, finishedAt: null, queuedAt: at(-60 * 1000) }));

    await expect(setup(runs).latest(WS, PID)).resolves.toMatchObject({ active: { id: 'now' }, last: { id: 'done' } });
  });

  it('returns no run for a product with none', async () => {
    await expect(setup(new InMemoryPriceResearchRunRepository()).latest(WS, PID)).resolves.toEqual({ active: null, last: null });
  });

  it('writes an expired lease as a failed run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));

    const latest = await setup(runs).latest(WS, PID);

    expect(latest.active).toBeNull();
    expect(latest.last).toMatchObject({ id: 'stuck', status: 'finished', outcome: 'failed', errorCode: 'lease_expired', consecutiveFailures: 1 });
  });

  it('writes a queued run whose job was lost as a failed run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'lost', status: 'queued', outcome: null, startedAt: null, finishedAt: null, queuedAt: at(-61 * 60 * 1000) }));

    const latest = await setup(runs).latest(WS, PID);

    expect(latest.active).toBeNull();
    expect(latest.last).toMatchObject({ id: 'lost', outcome: 'failed', errorCode: 'job_lost', nextAutoAt: at(HOUR_MS) });
  });

  it('keeps the failure count of the last finished run when it writes an expiry', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'done', outcome: 'failed', consecutiveFailures: 2 }));
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));

    const latest = await setup(runs).latest(WS, PID);

    expect(latest.last).toMatchObject({ id: 'stuck', consecutiveFailures: 3 });
  });
});

describe('PriceResearchRuns.history', () => {
  it('lists every run of the product newest first, up to the limit', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'a', queuedAt: at(-3 * HOUR_MS) }));
    runs.runs.push(storedRun({ id: 'b', queuedAt: at(-2 * HOUR_MS) }));
    runs.runs.push(storedRun({ id: 'c', status: 'queued', outcome: null, finishedAt: null, queuedAt: at(-60 * 1000) }));

    expect((await setup(runs).history(WS, PID, 20)).map((run) => run.id)).toEqual(['c', 'b', 'a']);
    expect((await setup(runs).history(WS, PID, 2)).map((run) => run.id)).toEqual(['c', 'b']);
  });

  it('lists an expired active run as failed', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1), queuedAt: at(-HOUR_MS) }));

    await expect(setup(runs).history(WS, PID, 20)).resolves.toMatchObject([
      { id: 'stuck', status: 'finished', outcome: 'failed', errorCode: 'lease_expired' },
    ]);
  });

  it('returns an empty list for a product with no runs', async () => {
    await expect(setup(new InMemoryPriceResearchRunRepository()).history(WS, PID, 20)).resolves.toEqual([]);
  });
});
