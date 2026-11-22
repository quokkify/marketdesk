import type { ProductRecheckResult, SaleVerdict } from '../../../../../shared/types';
import type { CompletedVerdictFields, ISaleVerdictRepository, NewVerdictRun } from '../../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type { SaleVerdictJob } from '../../../ports/IJobQueue';
import { InMemoryPriceResearchRunRepository } from '../../../../domain/testkit/support';
import { ANALYSIS_RUNNING, SaleVerdictRuns, VERDICT_QUEUED_TTL_MS } from '../SaleVerdictRuns';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const WS = 'w1';
const PID = 'p1';

class Verdicts implements Partial<ISaleVerdictRepository> {
  rows: SaleVerdict[] = [];
  errorCodes = new Map<string, string>();
  leases = new Map<string, string>();
  async claim(runId: string, _startedAt: string, leaseUntil: string): Promise<SaleVerdict | null> {
    const row = this.rows.find((r) => r.id === runId && r.status === 'queued');
    if (!row) return null;
    row.status = 'running';
    this.leases.set(runId, leaseUntil);
    return row;
  }
  async failExpired(_ws: string, _pid: string, now: string, queuedBefore: string, errorCode: string): Promise<boolean> {
    const row = this.rows.find(
      (r) =>
        (r.status === 'running' && (this.leases.get(r.id) ?? '') < now) ||
        (r.status === 'queued' && r.createdAt < queuedBefore),
    );
    return row ? this.fail(row.id, now, errorCode) : false;
  }
  async insertQueued(run: NewVerdictRun): Promise<SaleVerdict | null> {
    if (this.rows.some((r) => r.status === 'queued' || r.status === 'running')) return null;
    const row: SaleVerdict = {
      id: run.id, productId: run.productId, listingId: null, graphVersion: run.graphVersion, scope: run.scope,
      status: 'queued', overall: null, checks: {}, researchRunId: null, errorCode: null, createdAt: run.queuedAt,
      completedAt: null,
    };
    this.rows.push(row);
    return row;
  }
  async findActive(): Promise<SaleVerdict | null> {
    return this.rows.find((r) => r.status === 'queued' || r.status === 'running') ?? null;
  }
  async fail(runId: string, completedAt: string, errorCode: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === runId);
    if (!row) return false;
    Object.assign(row, { status: 'failed', completedAt, errorCode });
    this.errorCodes.set(runId, errorCode);
    return true;
  }
  async complete(runId: string, fields: CompletedVerdictFields): Promise<boolean> {
    const row = this.rows.find((r) => r.id === runId);
    if (!row) return false;
    Object.assign(row, { status: 'completed', ...fields });
    return true;
  }
  async setListing(): Promise<void> {}
  async setResearchRun(runId: string, researchRunId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === runId);
    if (row) row.researchRunId = researchRunId;
  }
  async findLatestCompleted(): Promise<SaleVerdict | null> {
    return this.rows.filter((r) => r.status === 'completed').pop() ?? null;
  }
  async listForProduct(_ws: string, _pid: string, limit: number): Promise<SaleVerdict[]> {
    return [...this.rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async lastRunFailedForProducts(): Promise<Set<string>> {
    return new Set();
  }
}

function setup(options: { enqueue?: () => Promise<void>; recheck?: () => Promise<ProductRecheckResult> } = {}) {
  const verdicts = new Verdicts();
  const researchRuns = new InMemoryPriceResearchRunRepository();
  const jobs: SaleVerdictJob[] = [];
  const errors: string[] = [];
  const result = { productId: PID, listingId: 'l1', status: 'ready', items: [] } as unknown as ProductRecheckResult;
  let n = 0;
  const runs = new SaleVerdictRuns({
    products: { findByIdForWorkspace: async (id: string) => (id === PID ? ({ id: PID } as never) : null) },
    listings: { findByIdForWorkspace: async () => ({ id: 'l1', marketplaceId: 'm1' } as never) },
    marketplaces: { findByIdForWorkspace: async () => null },
    workspaces: { findById: async () => ({ id: WS } as never) },
    verdicts: verdicts as unknown as ISaleVerdictRepository,
    researchRuns,
    queue: {
      enqueue: async (job) => {
        if (options.enqueue) await options.enqueue();
        jobs.push(job);
      },
      enqueueAll: async () => {},
    },
    recheck: { recheck: options.recheck ?? (async () => result) },
    infoCheckFor: () => async (ctx) => ({ check: 'info', status: 'ready', reasons: [], checkedAt: ctx.now().toISOString(), refs: { eventIds: [] } }),
    newId: () => `run-${++n}`,
    now: () => NOW,
    logger: { error: (_context, message) => errors.push(message) },
  });
  return { runs, verdicts, researchRuns, jobs, errors, result };
}

describe('SaleVerdictRuns', () => {
  it('queues a run and enqueues its ids with forceResearch', async () => {
    const { runs, jobs } = setup();

    const out = await runs.request(WS, PID, ['price'], 'manual', { forceResearch: true });

    expect(out.enqueued).toBe(true);
    expect(out.run).toMatchObject({ status: 'queued', scope: ['price'] });
    expect(jobs).toEqual([{ workspaceId: WS, productId: PID, runId: 'run-1', forceResearch: true, researchRunId: 'run-2' }]);
  });

  it('records the forced research as a queued manual run before the job runs', async () => {
    const { runs, researchRuns } = setup();

    await runs.request(WS, PID, ['price'], 'manual', { forceResearch: true });

    await expect(researchRuns.findActive(WS, PID)).resolves.toMatchObject({
      id: 'run-2', status: 'queued', trigger: 'manual', queuedAt: NOW.toISOString(),
    });
  });

  it('links the verdict run to the forced research run it queued', async () => {
    const { runs, verdicts } = setup();

    await runs.request(WS, PID, ['price'], 'manual', { forceResearch: true });

    await expect(verdicts.findActive()).resolves.toMatchObject({ id: 'run-1', researchRunId: 'run-2' });
  });

  it('records no research run for a request that does not force research', async () => {
    const { runs, researchRuns, jobs } = setup();

    await runs.request(WS, PID, ['price'], 'manual');

    expect(researchRuns.runs).toHaveLength(0);
    expect(jobs[0]?.researchRunId).toBeUndefined();
  });

  it('finishes the queued research run when the job cannot be enqueued', async () => {
    const { runs, researchRuns } = setup({ enqueue: async () => { throw new Error('redis down'); } });

    await expect(runs.request(WS, PID, ['price'], 'manual', { forceResearch: true })).rejects.toThrow('redis down');

    expect(researchRuns.runs[0]).toMatchObject({ status: 'finished', outcome: 'failed', errorCode: 'enqueue_failed' });
    await expect(researchRuns.findActive(WS, PID)).resolves.toBeNull();
  });

  it('fails the verdict run when the forced research row cannot be recorded', async () => {
    const { runs, verdicts, researchRuns, jobs } = setup();
    researchRuns.insertQueued = async () => { throw new Error('db down'); };

    await expect(runs.request(WS, PID, ['price'], 'manual', { forceResearch: true })).rejects.toThrow('db down');

    expect(verdicts.errorCodes.get('run-1')).toBe('enqueue_failed');
    expect(jobs).toHaveLength(0);
    await expect(verdicts.findActive()).resolves.toBeNull();
  });

  it('refuses a forced refresh while a research run is active and fails the new verdict run', async () => {
    const { runs, verdicts, researchRuns, jobs } = setup();
    await researchRuns.insertQueued({ id: 'research-0', workspaceId: WS, productId: PID, trigger: 'auto', queuedAt: NOW.toISOString() });

    await expect(runs.request(WS, PID, ['price'], 'manual', { forceResearch: true })).rejects.toMatchObject({
      message: ANALYSIS_RUNNING,
    });

    expect(verdicts.errorCodes.get('run-1')).toBe('research_active');
    expect(jobs).toHaveLength(0);
    await expect(verdicts.findActive()).resolves.toBeNull();
  });

  it('still fails the verdict run when finishing the queued research run throws', async () => {
    const { runs, verdicts, researchRuns } = setup({ enqueue: async () => { throw new Error('redis down'); } });
    researchRuns.finish = async () => { throw new Error('db down'); };

    await expect(runs.request(WS, PID, ['price'], 'manual', { forceResearch: true })).rejects.toThrow('redis down');

    expect(verdicts.errorCodes.get('run-1')).toBe('enqueue_failed');
    await expect(verdicts.findActive()).resolves.toBeNull();
  });

  it('joins an active run that already forces the price research', async () => {
    const { runs, jobs } = setup();
    await runs.request(WS, PID, ['info', 'price'], 'manual', { forceResearch: true });

    const out = await runs.request(WS, PID, ['price'], 'manual', { forceResearch: true });

    expect(out).toMatchObject({ enqueued: false, run: { id: 'run-1' } });
    expect(jobs).toHaveLength(1);
  });

  it.each([
    ['an analysis without forced research', ['info', 'price'], false],
    ['a run without the price scope', ['info'], true],
  ])('refuses a forced refresh while %s is active', async (_name, scope, force) => {
    const { runs, jobs } = setup();
    await runs.request(WS, PID, scope as never, 'manual', { forceResearch: force });

    await expect(runs.request(WS, PID, ['price'], 'manual', { forceResearch: true })).rejects.toMatchObject({
      message: ANALYSIS_RUNNING,
    });
    expect(jobs).toHaveLength(1);
  });

  it('rejects a missing product with not found', async () => {
    const { runs } = setup();

    await expect(runs.request(WS, 'other', ['info'], 'manual')).rejects.toThrow('Product not found');
  });

  it('returns the active run without enqueueing', async () => {
    const { runs, jobs } = setup();
    await runs.request(WS, PID, ['info'], 'manual');

    const out = await runs.request(WS, PID, ['price'], 'research');

    expect(out).toMatchObject({ enqueued: false, run: { id: 'run-1' } });
    expect(jobs).toHaveLength(1);
  });

  const stuck = (status: SaleVerdict['status'], queuedAgoMs: number): SaleVerdict => ({
    id: 'old', productId: PID, listingId: null, graphVersion: 'sale-verdict@1', scope: ['info'], status,
    overall: null, checks: {}, researchRunId: null, errorCode: null, createdAt: new Date(NOW.getTime() - queuedAgoMs).toISOString(), completedAt: null,
  });
  const MIN = 60 * 1000;

  it('does not expire a running run that was queued long ago while its lease holds', async () => {
    const { runs, verdicts, jobs } = setup();
    verdicts.rows.push(stuck('running', 20 * MIN));
    verdicts.leases.set('old', new Date(NOW.getTime() + 4 * MIN).toISOString());

    const out = await runs.request(WS, PID, ['info'], 'manual');

    expect(out).toMatchObject({ enqueued: false, run: { id: 'old' } });
    expect(verdicts.errorCodes.has('old')).toBe(false);
    expect(jobs).toHaveLength(0);
  });

  it('expires a running run past its lease before queueing a new one', async () => {
    const { runs, verdicts, jobs } = setup();
    verdicts.rows.push(stuck('running', 20 * MIN));
    verdicts.leases.set('old', new Date(NOW.getTime() - MIN).toISOString());

    const out = await runs.request(WS, PID, ['info'], 'manual');

    expect(verdicts.errorCodes.get('old')).toBe('expired');
    expect(out.enqueued).toBe(true);
    expect(jobs).toHaveLength(1);
  });

  it('does not expire a queued run within the queued TTL', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push(stuck('queued', 30 * MIN));

    const view = await runs.view(WS, PID);

    expect(view.active?.id).toBe('old');
  });

  it('view expires a queued run older than the queued TTL', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push(stuck('queued', VERDICT_QUEUED_TTL_MS + 1000));

    const view = await runs.view(WS, PID);

    expect(view.active).toBeNull();
    expect(verdicts.errorCodes.get('old')).toBe('expired');
  });

  it('view returns the error code of the newest run when it failed', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push(stuck('queued', VERDICT_QUEUED_TTL_MS + 1000));

    const view = await runs.view(WS, PID);

    expect(view).toMatchObject({ lastFailed: true, lastFailedCode: 'expired' });
  });

  it('view has no failed code when the newest run did not fail', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push({ ...stuck('failed', 2 * MIN), id: 'older', errorCode: 'run_error' });
    verdicts.rows.push({ ...stuck('completed', MIN), id: 'newer', overall: 'ready' });

    const view = await runs.view(WS, PID);

    expect(view).toMatchObject({ lastFailed: false, lastFailedCode: null });
    expect(view.latest?.id).toBe('newer');
  });

  it('fails a run that could not be enqueued and rethrows', async () => {
    const { runs, verdicts, errors } = setup({ enqueue: async () => { throw new Error('redis down'); } });

    await expect(runs.request(WS, PID, ['info'], 'manual')).rejects.toThrow('redis down');

    expect(verdicts.errorCodes.get('run-1')).toBe('enqueue_failed');
    expect(errors).toEqual(['Sale verdict run not queued']);
  });

  it('recheckInfo returns the Recheck result and stores a completed info verdict', async () => {
    const { runs, verdicts, result } = setup();

    const out = await runs.recheckInfo(WS, PID, 'l1');

    expect(out).toBe(result);
    expect(verdicts.rows[0]).toMatchObject({ status: 'completed', scope: ['info'], graphVersion: 'sale-verdict@1', overall: 'ready' });
  });

  it('recheckInfo still returns the Recheck result when storing the verdict fails', async () => {
    const { runs, verdicts, errors, result } = setup();
    verdicts.complete = async () => { throw new Error('db down'); };

    await expect(runs.recheckInfo(WS, PID, 'l1')).resolves.toBe(result);

    expect(errors).toEqual(['Storing the sale verdict of a recheck failed']);
    expect(verdicts.rows[0]).toMatchObject({ status: 'failed' });
    expect(verdicts.errorCodes.get('run-1')).toBe('store_failed');
  });
});

describe('SaleVerdictRuns.history', () => {
  it('lists the product\'s runs newest first, up to the limit', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push(
      { id: 'old', productId: PID, createdAt: '2026-11-20T00:00:00.000Z', status: 'failed' } as SaleVerdict,
      { id: 'new', productId: PID, createdAt: '2026-11-21T00:00:00.000Z', status: 'completed' } as SaleVerdict,
    );

    expect((await runs.history(WS, PID, 20)).map((row) => row.id)).toEqual(['new', 'old']);
    expect((await runs.history(WS, PID, 1)).map((row) => row.id)).toEqual(['new']);
  });

  it('expires a stuck run before listing it', async () => {
    const { runs, verdicts } = setup();
    verdicts.rows.push({
      id: 'lost', productId: PID, status: 'queued', createdAt: new Date(NOW.getTime() - VERDICT_QUEUED_TTL_MS - 1).toISOString(),
    } as SaleVerdict);

    await expect(runs.history(WS, PID, 20)).resolves.toMatchObject([{ id: 'lost', status: 'failed' }]);
  });

  it('throws NotFoundError for a product that is not in the workspace', async () => {
    await expect(setup().runs.history(WS, 'other', 20)).rejects.toThrow('Product not found');
  });
});
