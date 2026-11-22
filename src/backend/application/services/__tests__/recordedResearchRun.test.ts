import { InMemoryPriceResearchRunRepository } from '../../../domain/testkit/support';
import { RecordedResearchRun } from '../recordedResearchRun';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const NEW_RUN = { id: 'new', workspaceId: WS, productId: PID, trigger: 'manual' as const };

function setup() {
  const runs = new InMemoryPriceResearchRunRepository();
  const run = jest.fn(async () => ({ outcome: 'ok', nodes: {}, failedTiers: [], errorCode: null, rowsChanged: false }));
  const published: unknown[] = [];
  const recorded = new RecordedResearchRun({
    runs,
    graph: { run } as never,
    events: { publish: async (event: unknown) => { published.push(event); } } as never,
    now: () => NOW,
  });
  return { runs, recorded, run, published };
}

describe('RecordedResearchRun.start', () => {
  it('records a new queued run and executes it when none is given', async () => {
    const { runs, recorded } = setup();

    const out = await recorded.start(NEW_RUN, new AbortController().signal);

    expect(out).toMatchObject({ kind: 'finished', outcome: 'ok', run: { id: 'new' } });
    expect(runs.runs.map((r) => r.id)).toEqual(['new']);
  });

  it('executes the run queued at request time instead of inserting another', async () => {
    const { runs, recorded } = setup();
    await runs.insertQueued({ ...NEW_RUN, id: 'queued-earlier', queuedAt: NOW.toISOString() });

    const out = await recorded.start(NEW_RUN, new AbortController().signal, 'queued-earlier');

    expect(out).toMatchObject({ kind: 'finished', run: { id: 'queued-earlier' } });
    expect(runs.runs.map((r) => [r.id, r.status])).toEqual([['queued-earlier', 'finished']]);
  });

  it('records a new run when the given one is gone', async () => {
    const { runs, recorded } = setup();

    const out = await recorded.start(NEW_RUN, new AbortController().signal, 'missing');

    expect(out).toMatchObject({ kind: 'finished', run: { id: 'new' } });
    expect(runs.runs.map((r) => r.id)).toEqual(['new']);
  });

  it('reports active when the given run was taken and another holds the product', async () => {
    const { runs, recorded, run } = setup();
    await runs.insertQueued({ ...NEW_RUN, id: 'other', queuedAt: NOW.toISOString() });

    const out = await recorded.start(NEW_RUN, new AbortController().signal, 'missing');

    expect(out).toEqual({ kind: 'active' });
    expect(run).not.toHaveBeenCalled();
  });
});
