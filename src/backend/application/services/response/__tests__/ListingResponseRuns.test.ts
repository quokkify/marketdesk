import { Product } from '../../../../domain/entities/Product';
import { Listing } from '../../../../domain/entities/Listing';
import { Marketplace } from '../../../../domain/entities/Marketplace';
import { InvalidStateError, NotFoundError } from '../../../../domain/shared/DomainError';
import {
  InMemoryListingRepository,
  InMemoryListingResponseRunRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../../domain/testkit/support';
import { subjectFingerprint } from '../../../../domain/services/listingResponseRules';
import type { ListingResponseJob } from '../../../ports/IJobQueue';
import { VERDICT_QUEUED_TTL_MS } from '../../verdict/SaleVerdictRuns';
import { LISTING_RESPONSE_GRAPH_VERSION } from '../ListingResponseGraph';
import { ListingResponseRuns, REUSE_WINDOW_MS } from '../ListingResponseRuns';

const WS = 'w1';
const PID = 'p1';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const MINUTE = 60 * 1000;

function fingerprint(price: number): string {
  return subjectFingerprint({ title: 'AirPods 4 Apple', price, categoryId: null });
}

function setup(options: { enqueue?: () => Promise<void>; status?: 'live' | 'draft'; marketplaceKey?: 'olx' | 'allegro' } = {}) {
  const products = new InMemoryProductRepository();
  products.items.set(PID, unwrap(Product.create({
    id: PID, workspaceId: WS, sku: 'SKU-1', name: 'AirPods 4 Apple',
    description: 'Wireless earbuds in good condition.', costPrice: money(50), sellingPrice: money(200), condition: 'good',
    category: 'headphones',
  })));
  const marketplaces = new InMemoryMarketplaceRepository();
  marketplaces.items.set('m1', unwrap(Marketplace.create({
    id: 'm1', workspaceId: WS, key: options.marketplaceKey ?? 'olx', name: 'OLX', connected: true,
  })));
  const listings = new InMemoryListingRepository();
  const setPrice = (price: number) =>
    listings.items.set('l1', unwrap(Listing.create({
      id: 'l1', productId: PID, marketplaceId: 'm1', price: money(price), marketplaceListingId: '900100',
      status: options.status ?? 'live', views: 0, watchers: 0, conversations: 0, messages: 0,
    })));
  setPrice(200);
  const endListing = () =>
    listings.items.set('l1', unwrap(Listing.create({
      id: 'l1', productId: PID, marketplaceId: 'm1', price: money(200), marketplaceListingId: '900100',
      status: 'expired', views: 0, watchers: 0, conversations: 0, messages: 0,
    })));
  const relist = () => {
    endListing();
    listings.items.set('l2', unwrap(Listing.create({
      id: 'l2', productId: PID, marketplaceId: 'm1', price: money(200), marketplaceListingId: '900200',
      status: 'live', views: 0, watchers: 0, conversations: 0, messages: 0,
    })));
  };

  const repo = new InMemoryListingResponseRunRepository();
  const jobs: ListingResponseJob[] = [];
  const errors: Array<Record<string, unknown>> = [];
  let n = 0;
  let now = NOW;
  const runs = new ListingResponseRuns({
    products,
    listings,
    marketplaces,
    runs: repo,
    queue: {
      enqueue: async (job) => {
        if (options.enqueue) await options.enqueue();
        jobs.push(job);
      },
      enqueueAll: async () => {},
    },
    newId: () => `run-${++n}`,
    now: () => now,
    logger: { error: (context) => errors.push(context) },
  });
  const seedCompleted = async (id: string, completedAt: Date, fp: string) => {
    await repo.insertQueued({
      id, workspaceId: WS, productId: PID, listingId: 'l1', graphVersion: LISTING_RESPONSE_GRAPH_VERSION,
      fingerprint: fp, queuedAt: completedAt.toISOString(),
    });
    await repo.complete(id, { stage: 'not_seen', signal: null, probes: [], findings: [], completedAt: completedAt.toISOString() });
  };
  return { runs, repo, jobs, errors, setPrice, relist, endListing, seedCompleted, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe('ListingResponseRuns.request', () => {
  it('queues a run for the live OLX listing and enqueues its ids', async () => {
    const { runs, jobs } = setup();

    const out = await runs.request(WS, PID);

    expect(out).toMatchObject({ enqueued: true, reused: false, run: { id: 'run-1', status: 'queued', listingId: 'l1' } });
    expect(out.run.fingerprint).toBe(fingerprint(200));
    expect(jobs).toEqual([{ workspaceId: WS, productId: PID, runId: 'run-1' }]);
  });

  it('reuses a completed run younger than the window with the same fingerprint', async () => {
    const { runs, jobs, seedCompleted } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - REUSE_WINDOW_MS + MINUTE), fingerprint(200));

    const out = await runs.request(WS, PID);

    expect(out).toMatchObject({ enqueued: false, reused: true, run: { id: 'done-1' } });
    expect(jobs).toHaveLength(0);
  });

  it('does not reuse a run older than the window', async () => {
    const { runs, jobs, seedCompleted } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - REUSE_WINDOW_MS - MINUTE), fingerprint(200));

    const out = await runs.request(WS, PID);

    expect(out).toMatchObject({ enqueued: true, reused: false });
    expect(jobs).toHaveLength(1);
  });

  it('does not reuse a run when the listing price changed', async () => {
    const { runs, seedCompleted, setPrice } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));
    setPrice(180);

    const out = await runs.request(WS, PID);

    expect(out).toMatchObject({ enqueued: true, reused: false });
  });

  it('returns the active run for a second request without enqueueing again', async () => {
    const { runs, jobs } = setup();
    const first = await runs.request(WS, PID);

    const second = await runs.request(WS, PID);

    expect(second).toMatchObject({ enqueued: false, reused: false, run: { id: first.run.id } });
    expect(jobs).toHaveLength(1);
  });

  it('fails a run stuck queued past the TTL and queues a new one', async () => {
    const { runs, repo, advance } = setup();
    const first = await runs.request(WS, PID);
    advance(VERDICT_QUEUED_TTL_MS + MINUTE);

    const second = await runs.request(WS, PID);

    expect(second.run.id).not.toBe(first.run.id);
    await expect(repo.findById(WS, first.run.id)).resolves.toMatchObject({ status: 'failed', errorCode: 'expired' });
  });

  it('fails the run with enqueue_failed and rethrows when the queue throws', async () => {
    const { runs, repo, errors } = setup({ enqueue: async () => { throw new Error('redis down'); } });

    await expect(runs.request(WS, PID)).rejects.toThrow('redis down');

    await expect(repo.findById(WS, 'run-1')).resolves.toMatchObject({ status: 'failed', errorCode: 'enqueue_failed' });
    expect(errors).toHaveLength(1);
  });

  it('rejects an unknown product with NotFoundError', async () => {
    const { runs } = setup();

    await expect(runs.request(WS, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(runs.request('other', PID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a product without a live OLX listing with InvalidStateError', async () => {
    await expect(setup({ status: 'draft' }).runs.request(WS, PID)).rejects.toBeInstanceOf(InvalidStateError);
    await expect(setup({ marketplaceKey: 'allegro' }).runs.request(WS, PID)).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe('ListingResponseRuns.view', () => {
  it('reports lastFailed while still returning the older completed run', async () => {
    const { runs, repo, seedCompleted } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - 10 * REUSE_WINDOW_MS), fingerprint(200));
    const { run } = await runs.request(WS, PID);
    await repo.fail(run.id, NOW.toISOString(), 'run_error');

    const view = await runs.view(WS, PID);

    expect(view).toMatchObject({ latest: { id: 'done-1' }, active: null, lastFailed: true, outOfDate: false });
  });

  it('reports the active run', async () => {
    const { runs } = setup();
    const { run } = await runs.request(WS, PID);

    await expect(runs.view(WS, PID)).resolves.toMatchObject({ latest: null, active: { id: run.id }, lastFailed: false });
  });

  it('is out of date after the listing price changed', async () => {
    const { runs, seedCompleted, setPrice } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));
    setPrice(180);

    await expect(runs.view(WS, PID)).resolves.toMatchObject({ latest: { id: 'done-1' }, outOfDate: true });
  });

  it('answers an empty view for a product without a live OLX listing', async () => {
    const { runs } = setup({ status: 'draft' });

    await expect(runs.view(WS, PID)).resolves.toEqual({ latest: null, active: null, lastFailed: false, outOfDate: false });
  });

  it('rejects an unknown or foreign product with NotFoundError', async () => {
    const { runs } = setup();

    await expect(runs.view('other', PID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ListingResponseRuns.latestFor', () => {
  const page = [{ id: PID, name: 'AirPods 4 Apple' }, { id: 'p2', name: 'Other' }];

  it('maps each product to the latest completed run of its live OLX listing', async () => {
    const { runs, seedCompleted } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));

    const latest = await runs.latestFor(WS, page);

    expect([...latest.keys()]).toEqual([PID]);
    expect(latest.get(PID)).toMatchObject({ run: { id: 'done-1' }, outOfDate: false });
  });

  it('marks the run out of date when the listing price changed after it', async () => {
    const { runs, seedCompleted, setPrice } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));
    setPrice(180);

    const latest = await runs.latestFor(WS, page);

    expect(latest.get(PID)).toMatchObject({ run: { id: 'done-1' }, outOfDate: true });
  });

  it('drops a run made for an earlier listing after a relist', async () => {
    const { runs, seedCompleted, relist } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));
    relist();

    expect((await runs.latestFor(WS, page)).has(PID)).toBe(false);
  });

  it('drops the run when the product has no live listing', async () => {
    const { runs, seedCompleted, endListing } = setup();
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));
    endListing();

    expect((await runs.latestFor(WS, page)).has(PID)).toBe(false);
  });

  it('drops the run when the live listing is not on OLX', async () => {
    const { runs, seedCompleted } = setup({ marketplaceKey: 'allegro' });
    await seedCompleted('done-1', new Date(NOW.getTime() - MINUTE), fingerprint(200));

    expect((await runs.latestFor(WS, page)).has(PID)).toBe(false);
  });
});
