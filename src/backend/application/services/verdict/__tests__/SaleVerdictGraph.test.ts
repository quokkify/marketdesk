import { Product } from '../../../../domain/entities/Product';
import { Listing } from '../../../../domain/entities/Listing';
import { Workspace } from '../../../../domain/entities/Workspace';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../../domain/testkit/support';
import type {
  CompletedVerdictFields,
  ISaleVerdictRepository,
  NewVerdictRun,
} from '../../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type { SaleVerdict, VerdictCheck, VerdictCheckName } from '../../../../../shared/types';
import { SALE_VERDICT_GRAPH_VERSION, SaleVerdictGraph, type CheckContext, type CheckGraph } from '../SaleVerdictGraph';

const WS = 'w1';
const PID = 'p1';
const RUN_ID = 'run-2';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const EARLIER = '2026-11-20T08:00:00.000Z';

// Only what the graph uses; the other methods are not reached by a run.
class InMemorySaleVerdictRepository implements ISaleVerdictRepository {
  readonly rows: SaleVerdict[] = [];
  readonly listingIds = new Map<string, string | null>();

  async insertQueued(run: NewVerdictRun): Promise<SaleVerdict | null> {
    const row: SaleVerdict = {
      id: run.id, productId: run.productId, listingId: null, graphVersion: run.graphVersion, scope: run.scope,
      status: 'queued', overall: null, checks: {}, researchRunId: null, errorCode: null, createdAt: run.queuedAt,
      completedAt: null,
    };
    this.rows.push(row);
    return row;
  }
  async findActive(): Promise<SaleVerdict | null> {
    return this.rows.find((row) => row.status === 'queued' || row.status === 'running') ?? null;
  }
  async claim(runId: string): Promise<SaleVerdict | null> {
    const row = this.rows.find((r) => r.id === runId && r.status === 'queued');
    if (!row) return null;
    row.status = 'running';
    return row;
  }
  async setListing(runId: string, listingId: string | null): Promise<void> {
    this.listingIds.set(runId, listingId);
  }
  async setResearchRun(runId: string, researchRunId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === runId);
    if (row) row.researchRunId = researchRunId;
  }
  async complete(runId: string, fields: CompletedVerdictFields): Promise<boolean> {
    const row = this.rows.find((r) => r.id === runId);
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
    Object.assign(row, { status: 'completed', overall: fields.overall, checks: fields.checks, completedAt: fields.completedAt });
    return true;
  }
  async fail(runId: string, completedAt: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === runId);
    if (!row) return false;
    Object.assign(row, { status: 'failed', completedAt });
    return true;
  }
  async failExpired(): Promise<boolean> {
    return false;
  }
  async findById(_workspaceId: string, runId: string): Promise<SaleVerdict | null> {
    return this.rows.find((r) => r.id === runId) ?? null;
  }
  async listForProduct(): Promise<SaleVerdict[]> {
    return [];
  }
  async findLatestCompleted(_workspaceId: string, productId: string): Promise<SaleVerdict | null> {
    const done = this.rows.filter((r) => r.productId === productId && r.status === 'completed');
    return done[done.length - 1] ?? null;
  }
  async findLatestCompletedForProducts(): Promise<Map<string, SaleVerdict>> {
    return new Map();
  }
  async lastRunFailedForProducts(): Promise<Set<string>> {
    return new Set();
  }
}

function check(name: VerdictCheckName, status: VerdictCheck['status'], checkedAt: string): VerdictCheck {
  return { check: name, status, reasons: [], checkedAt, refs: { eventIds: [] } };
}

const PREVIOUS: SaleVerdict = {
  id: 'run-1', productId: PID, listingId: 'l1', graphVersion: SALE_VERDICT_GRAPH_VERSION,
  scope: ['info', 'price', 'photos'], status: 'completed', overall: 'fix', researchRunId: null, errorCode: null,
  checks: {
    info: check('info', 'ready', EARLIER),
    price: check('price', 'fix', EARLIER),
    photos: check('photos', 'fix', EARLIER),
  },
  createdAt: EARLIER, completedAt: EARLIER,
};

function setup(fakes: Partial<Record<VerdictCheckName, CheckGraph>> = {}) {
  const products = new InMemoryProductRepository();
  products.items.set(PID, unwrap(Product.create({
    id: PID, workspaceId: WS, sku: 'SKU-1', name: 'AOPEN QH11 projector',
    description: 'Mini projector in good condition.', costPrice: money(50), sellingPrice: money(200), condition: 'good', category: 'projectors',
  })));
  const listings = new InMemoryListingRepository();
  listings.items.set('l1', unwrap(Listing.create({ id: 'l1', productId: PID, marketplaceId: 'm1', price: money(200) })));
  const workspace = unwrap(Workspace.create({ id: WS, name: 'Shop' }));
  const verdicts = new InMemorySaleVerdictRepository();
  verdicts.rows.push(structuredClone(PREVIOUS));
  verdicts.rows.push({ ...structuredClone(PREVIOUS), id: RUN_ID, status: 'running', overall: null, checks: {}, completedAt: null });

  const calls: VerdictCheckName[] = [];
  const contexts: CheckContext[] = [];
  const fake = (name: VerdictCheckName, status: VerdictCheck['status']): CheckGraph => async (ctx) => {
    calls.push(name);
    contexts.push(ctx);
    return check(name, status, ctx.now().toISOString());
  };
  const graph = new SaleVerdictGraph({
    products,
    listings,
    marketplaces: new InMemoryMarketplaceRepository(),
    workspaces: { findById: async (id: string) => (id === WS ? workspace : null) },
    verdicts,
    checks: {
      info: fakes.info ?? fake('info', 'ready'),
      price: fakes.price ?? fake('price', 'ready'),
      photos: fakes.photos ?? fake('photos', 'ready'),
      category: fakes.category ?? fake('category', 'ready'),
      attributes: fakes.attributes ?? fake('attributes', 'ready'),
      delivery: fakes.delivery ?? fake('delivery', 'ready'),
    },
    now: () => NOW,
  });
  const run = (scope: VerdictCheckName[]) =>
    graph.run({ workspaceId: WS, productId: PID, runId: RUN_ID, scope, signal: new AbortController().signal });
  const runWith = (scope: VerdictCheckName[], options: Partial<CheckContext['options']>) =>
    graph.run({ workspaceId: WS, productId: PID, runId: RUN_ID, scope, options, signal: new AbortController().signal });
  return { run, runWith, calls, contexts, verdicts };
}

describe('SaleVerdictGraph routing', () => {
  it('runs only the scoped check and keeps the previous result of every other check', async () => {
    const { run, calls, verdicts } = setup();

    const verdict = await run(['price']);

    expect(calls).toEqual(['price']);
    expect(verdict.status).toBe('completed');
    expect(verdict.checks.price).toMatchObject({ status: 'ready', checkedAt: NOW.toISOString() });
    expect(verdict.checks.info).toEqual(PREVIOUS.checks.info);
    expect(verdict.checks.photos).toEqual(PREVIOUS.checks.photos);
    expect(verdict.overall).toBe('fix');
    expect(verdicts.listingIds.get(RUN_ID)).toBe('l1');
  });

  it('runs every check for the full scope', async () => {
    const { run, calls, contexts } = setup();

    const verdict = await run(['info', 'price', 'photos']);

    expect([...calls].sort()).toEqual(['info', 'photos', 'price']);
    expect(verdict.overall).toBe('ready');
    expect(contexts[0]!.listing?.id).toBe('l1');
    expect(contexts[0]!.options).toEqual({ forceResearch: false, infoCodeOnly: false });
  });

  it('runs no check for an empty scope and keeps every previous result', async () => {
    const { run, calls } = setup();

    const verdict = await run([]);

    expect(calls).toEqual([]);
    expect(verdict.status).toBe('completed');
    expect(verdict.checks).toEqual(PREVIOUS.checks);
    expect(verdict.overall).toBe('fix');
  });

  it('runs a check once however often the scope names it', async () => {
    const { run, calls } = setup();

    await run(['price', 'price', 'info', 'price']);

    expect([...calls].sort()).toEqual(['info', 'price']);
  });

  it('passes the run options to the checks', async () => {
    const { runWith, contexts } = setup();

    await runWith(['price'], { forceResearch: true, infoCodeOnly: true });

    expect(contexts[0]!.options).toEqual({ forceResearch: true, infoCodeOnly: true });
  });

  it('records a throwing check as check_failed and still completes the run', async () => {
    const { run, verdicts } = setup({
      photos: async () => {
        throw new Error('vision down');
      },
    });

    const verdict = await run(['info', 'price', 'photos']);

    expect(verdict.status).toBe('completed');
    expect(verdict.checks.photos).toMatchObject({ status: 'needs_human', reasons: [{ code: 'check_failed' }] });
    expect(verdict.overall).toBe('needs_human');
    expect(verdicts.rows.find((r) => r.id === RUN_ID)?.status).toBe('completed');
  });
});
