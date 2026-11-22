import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import {
  InMemoryListingRepository,
  InMemoryPriceResearchRepository,
  InMemoryPriceResearchRunRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import { RecordingJobQueue } from '../../testkit/support';
import { NotFoundError, TooManyRequestsError } from '../../../domain/shared/DomainError';
import type { NewResearchRun } from '../../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type { ResearchRun } from '../../../../shared/types';
import type { IJobQueue, PriceResearchJob } from '../../ports/IJobQueue';
import { PriceResearchRuns } from '../PriceResearchRuns';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function addProduct(
  products: InMemoryProductRepository,
  listings: InMemoryListingRepository,
  options: { id?: string; workspaceId?: string; currency?: string } = {},
): string {
  const id = options.id ?? PID;
  const product = unwrap(Product.create({
    id, workspaceId: options.workspaceId ?? WS, sku: `SKU-${id}`, name: 'AOPEN QH11 projektor',
    description: 'Mini projector in good condition, works fine.',
    costPrice: money(50), sellingPrice: money(200), condition: 'good', category: 'projectors',
  }));
  products.items.set(product.id, product);
  const listing = unwrap(Listing.create({
    id: `l-${id}`, productId: id, marketplaceId: 'm1', price: money(200, options.currency ?? 'PLN'),
  }));
  listings.items.set(listing.id, listing);
  return id;
}

function storedRun(fields: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'old', workspaceId: WS, productId: PID, trigger: 'manual', status: 'finished', nodes: {},
    outcome: 'ok', failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: at(-2 * HOUR_MS),
    startedAt: at(-2 * HOUR_MS), finishedAt: at(-HOUR_MS), leaseUntil: null, nextAutoAt: null,
    ...fields,
  };
}

class Logger {
  readonly errors: Array<{ context: Record<string, unknown>; message: string }> = [];
  error(context: Record<string, unknown>, message: string): void {
    this.errors.push({ context, message });
  }
}

function setup(options: {
  configured?: boolean;
  currency?: string;
  runs?: InMemoryPriceResearchRunRepository;
  queue?: IJobQueue<PriceResearchJob>;
  onExpired?: (workspaceId: string, productId: string) => Promise<unknown>;
  research?: InMemoryPriceResearchRepository;
} = {}) {
  const products = new InMemoryProductRepository();
  const listings = new InMemoryListingRepository();
  const logger = new Logger();
  addProduct(products, listings, { currency: options.currency });
  const runs = options.runs ?? new InMemoryPriceResearchRunRepository();
  const queue = new RecordingJobQueue<PriceResearchJob>();
  let n = 0;
  const research = options.research ?? new InMemoryPriceResearchRepository();
  const service = new PriceResearchRuns({
    products, listings, runs, research,
    queue: options.queue ?? queue,
    configured: options.configured ?? true,
    newId: () => `run-${++n}`,
    now: () => NOW,
    onExpired: options.onExpired,
    logger,
  });
  return { service, runs, queue, products, listings, logger };
}

describe('PriceResearchRuns.request', () => {
  it('records a queued run and enqueues its ids only', async () => {
    const { service, runs, queue } = setup();

    const result = await service.request(WS, PID, { force: false, trigger: 'analyze' });

    expect(result).toMatchObject({ enqueued: true, reason: 'enqueued', run: { id: 'run-1', status: 'queued', trigger: 'analyze' } });
    expect(runs.runs).toHaveLength(1);
    expect(queue.jobs.map((job) => job.data)).toEqual([{ workspaceId: WS, productId: PID, runId: 'run-1' }]);
  });

  it('returns the active run instead of queueing a second one', async () => {
    const { service, runs, queue } = setup();
    await service.request(WS, PID, { force: true, trigger: 'manual' });

    const second = await service.request(WS, PID, { force: true, trigger: 'manual' });

    expect(second).toMatchObject({ enqueued: false, reason: 'active', run: { id: 'run-1' } });
    expect(runs.runs).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('answers active when a concurrent request inserted the run first', async () => {
    class RacingRuns extends InMemoryPriceResearchRunRepository {
      override async insertQueued(run: NewResearchRun): Promise<ResearchRun | null> {
        await super.insertQueued({ ...run, id: 'concurrent' });
        return super.insertQueued(run);
      }
    }
    const { service, queue } = setup({ runs: new RacingRuns() });

    const result = await service.request(WS, PID, { force: true, trigger: 'manual' });

    expect(result).toMatchObject({ enqueued: false, reason: 'active', run: { id: 'concurrent' } });
    expect(queue.jobs).toHaveLength(0);
  });

  it('frees the product when the running run lease expired, recording it as a failure', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'prev', outcome: 'failed', consecutiveFailures: 1, finishedAt: at(-3 * HOUR_MS) }));
    runs.runs.push(storedRun({
      id: 'stuck', status: 'running', outcome: null, startedAt: at(-20 * 60 * 1000), finishedAt: null,
      leaseUntil: at(-60 * 1000),
    }));
    const { service, queue } = setup({ runs });

    const result = await service.request(WS, PID, { force: true, trigger: 'manual' });

    expect(result).toMatchObject({ enqueued: true, reason: 'enqueued', run: { id: 'run-1' } });
    expect(runs.runs.find((r) => r.id === 'stuck')).toMatchObject({
      status: 'finished', outcome: 'failed', errorCode: 'lease_expired', consecutiveFailures: 2,
      finishedAt: NOW.toISOString(), nextAutoAt: at(2 * HOUR_MS),
    });
    expect(queue.jobs).toHaveLength(1);
  });

  it('treats a queued run older than 60 minutes as a lost job and queues a new run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'prev', outcome: 'failed', consecutiveFailures: 1, finishedAt: at(-3 * HOUR_MS) }));
    runs.runs.push(storedRun({ id: 'lost', status: 'queued', outcome: null, startedAt: null, finishedAt: null, queuedAt: at(-61 * 60 * 1000) }));
    const { service, queue } = setup({ runs });

    const result = await service.request(WS, PID, { force: true, trigger: 'manual' });

    expect(result).toMatchObject({ enqueued: true, reason: 'enqueued', run: { id: 'run-1' } });
    expect(runs.runs.find((r) => r.id === 'lost')).toMatchObject({
      status: 'finished', outcome: 'failed', errorCode: 'job_lost', consecutiveFailures: 2,
      finishedAt: NOW.toISOString(), nextAutoAt: at(2 * HOUR_MS),
    });
    expect(queue.jobs).toHaveLength(1);
  });

  it('keeps a queued run younger than 60 minutes active', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'waiting', status: 'queued', outcome: null, finishedAt: null, queuedAt: at(-59 * 60 * 1000) }));
    const { service } = setup({ runs });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
      .resolves.toMatchObject({ enqueued: false, reason: 'active', run: { id: 'waiting' } });
  });

  it('does not count lost queued runs toward the 10-run cap', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    for (let i = 0; i < 10; i += 1) {
      runs.runs.push(storedRun({
        id: `q${i}`, productId: `other-${i}`, status: 'queued', outcome: null, finishedAt: null,
        queuedAt: at(-61 * 60 * 1000),
      }));
    }
    const { service } = setup({ runs });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
      .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });
  });

  it('keeps a running run with a live lease active', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'live', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(60 * 1000) }));
    const { service } = setup({ runs });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
      .resolves.toMatchObject({ enqueued: false, reason: 'active', run: { id: 'live' } });
  });

  it('does not run again before the next automatic run time unless forced', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ nextAutoAt: at(HOUR_MS) }));
    const { service, queue } = setup({ runs });

    const automatic = await service.request(WS, PID, { force: false, trigger: 'analyze' });
    expect(automatic).toMatchObject({ enqueued: false, reason: 'not_due', run: { id: 'old' } });
    expect(queue.jobs).toHaveLength(0);

    const forced = await service.request(WS, PID, { force: true, trigger: 'manual' });
    expect(forced).toMatchObject({ enqueued: true, reason: 'enqueued' });
  });

  describe('a product researched before runs existed', () => {
    function researchedAt(lastAttemptAt: string | null): InMemoryPriceResearchRepository {
      const research = new InMemoryPriceResearchRepository();
      research.items.set(`${WS}:${PID}`, {
        productId: PID, retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
        comparables: [], specs: null, dismissedUrls: [], lastAttemptAt, lastEstimate: null, updatedAt: at(-HOUR_MS),
      });
      return research;
    }

    it('is not due automatically within 7 days of its last research attempt', async () => {
      const { service, queue, runs } = setup({ research: researchedAt(at(-6 * 24 * HOUR_MS)) });

      await expect(service.request(WS, PID, { force: false, trigger: 'analyze' }))
        .resolves.toEqual({ run: null, enqueued: false, reason: 'not_due' });
      expect(queue.jobs).toHaveLength(0);
      expect(runs.runs).toHaveLength(0);
    });

    it('is due once 7 days have passed since that attempt', async () => {
      const { service } = setup({ research: researchedAt(at(-7 * 24 * HOUR_MS - 1)) });

      await expect(service.request(WS, PID, { force: false, trigger: 'analyze' }))
        .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });
    });

    it('runs at once when forced, or when it was never attempted', async () => {
      const { service } = setup({ research: researchedAt(at(-HOUR_MS)) });
      await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
        .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });

      const never = setup({ research: researchedAt(null) });
      await expect(never.service.request(WS, PID, { force: false, trigger: 'analyze' }))
        .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });
    });

    it('follows its runs, not the old attempt, once it has one', async () => {
      const runs = new InMemoryPriceResearchRunRepository();
      runs.runs.push(storedRun({ nextAutoAt: at(-1) }));
      const { service } = setup({ runs, research: researchedAt(at(-HOUR_MS)) });

      await expect(service.request(WS, PID, { force: false, trigger: 'analyze' }))
        .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });
    });
  });

  it('runs again automatically once the next automatic run time has passed', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ nextAutoAt: at(-1) }));
    const { service } = setup({ runs });

    await expect(service.request(WS, PID, { force: false, trigger: 'analyze' }))
      .resolves.toMatchObject({ enqueued: true, reason: 'enqueued' });
  });

  it('refuses an 11th queued run in a workspace with 429', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    for (let i = 0; i < 10; i += 1) {
      runs.runs.push(storedRun({ id: `q${i}`, productId: `other-${i}`, status: 'queued', outcome: null, finishedAt: null, queuedAt: at(-60 * 1000) }));
    }
    const { service, queue } = setup({ runs });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' })).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(runs.runs).toHaveLength(10);
    expect(queue.jobs).toHaveLength(0);
  });

  it('records no run when market search is not configured', async () => {
    const { service, runs, queue } = setup({ configured: false });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
      .resolves.toEqual({ run: null, enqueued: false, reason: 'not_configured' });
    expect(runs.runs).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it('records no run when the listing is not in PLN', async () => {
    const { service, runs, queue } = setup({ currency: 'EUR' });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' }))
      .resolves.toEqual({ run: null, enqueued: false, reason: 'not_pln' });
    expect(runs.runs).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it('answers 404 for a product of another workspace, whatever the setup', async () => {
    const { service, runs } = setup({ configured: false });

    await expect(service.request('w2', PID, { force: true, trigger: 'manual' })).rejects.toBeInstanceOf(NotFoundError);
    expect(runs.runs).toHaveLength(0);
  });

  it('finishes the run as a counted failure with backoff when it could not be queued', async () => {
    const failingQueue: IJobQueue<PriceResearchJob> = {
      enqueue: async () => { throw new Error('redis down'); },
      enqueueAll: async () => undefined,
    };
    const { service, runs } = setup({ queue: failingQueue });

    await expect(service.request(WS, PID, { force: true, trigger: 'manual' })).rejects.toThrow('redis down');
    expect(runs.runs[0]).toMatchObject({
      status: 'finished', outcome: 'failed', errorCode: 'enqueue_failed', consecutiveFailures: 1, nextAutoAt: at(HOUR_MS),
    });
  });
});

describe('PriceResearchRuns.latest', () => {
  it('returns the active and the last finished run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'done' }));
    runs.runs.push(storedRun({ id: 'now', status: 'queued', outcome: null, finishedAt: null, queuedAt: at(-60 * 1000) }));
    const { service } = setup({ runs });

    await expect(service.latest(WS, PID)).resolves.toMatchObject({ active: { id: 'now' }, last: { id: 'done' } });
  });

  it('writes an expired lease as a failed run', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));
    const { service } = setup({ runs });

    const latest = await service.latest(WS, PID);

    expect(latest.active).toBeNull();
    expect(latest.last).toMatchObject({ id: 'stuck', status: 'finished', outcome: 'failed', errorCode: 'lease_expired', consecutiveFailures: 1 });
  });

  it('hands an expired run to the re-estimate hook, so its pending notice does not stay', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));
    const expired: string[] = [];
    const { service } = setup({ runs, onExpired: async (workspaceId, productId) => { expired.push(`${workspaceId}:${productId}`); } });

    await service.latest(WS, PID);
    await service.latest(WS, PID);

    expect(expired).toEqual([`${WS}:${PID}`]);
  });

  it('hands a lost queued run found by a request to the re-estimate hook', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'lost', status: 'queued', outcome: null, startedAt: null, finishedAt: null, queuedAt: at(-61 * 60 * 1000) }));
    const expired: string[] = [];
    const { service } = setup({ runs, onExpired: async (workspaceId, productId) => { expired.push(`${workspaceId}:${productId}`); } });

    await service.request(WS, PID, { force: true, trigger: 'manual' });

    expect(expired).toEqual([`${WS}:${PID}`]);
  });

  it('does not call the hook when another reader already wrote the expiry', async () => {
    class AlreadyFinished extends InMemoryPriceResearchRunRepository {
      async finish(): Promise<boolean> {
        return false;
      }
    }
    const runs = new AlreadyFinished();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));
    let calls = 0;
    const { service } = setup({ runs, onExpired: async () => { calls += 1; } });

    await service.latest(WS, PID);

    expect(calls).toBe(0);
  });

  it('logs a failing hook and still answers', async () => {
    const runs = new InMemoryPriceResearchRunRepository();
    runs.runs.push(storedRun({ id: 'stuck', status: 'running', outcome: null, finishedAt: null, leaseUntil: at(-1) }));
    const { service, logger } = setup({ runs, onExpired: async () => { throw new Error('estimate failed'); } });

    await expect(service.latest(WS, PID)).resolves.toMatchObject({ active: null });
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.errors.map((e) => e.message)).toEqual(['Re-estimating after an expired price research run failed']);
  });
});
