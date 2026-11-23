import type { Pool, PoolClient } from 'pg';
import { ListingResponseRunRepository } from '../ListingResponseRunRepository';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-000000001601';
const OTHER_WS = '00000000-0000-4000-8000-000000001602';
const PID = '00000000-0000-4000-8000-000000001701';
const PID_2 = '00000000-0000-4000-8000-000000001702';
const LISTING = '00000000-0000-4000-8000-000000001751';
const LISTING_2 = '00000000-0000-4000-8000-000000001752';
const RUN = '00000000-0000-4000-8000-000000001801';
const RUN_2 = '00000000-0000-4000-8000-000000001802';
const RUN_3 = '00000000-0000-4000-8000-000000001803';

const NOW = '2026-11-22T12:00:00.000Z';
const later = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

const SIGNAL = {
  listingId: LISTING,
  stage: 'seen_not_contacted' as const,
  views: 120,
  viewsPerDay: 15,
  hoursLive: 200,
  viewsNeeded: null,
};
const PROBES = [{ query: 'rower górski', status: 'ok' as const, total: 340, firstPageSize: 40, position: 12, checked: 80 }];
const FINDINGS = [
  {
    code: 'deep_in_results' as const,
    message: 'The listing sits deep in the results.',
    action: 'edit_title' as const,
    evidence: { query: 'rower górski', position: 12, checked: 80, total: 340 },
  },
];

// Runs only against a session TEMP copy of listing_response_runs (without its foreign keys),
// never the real table. The repository is bound to the session's client.
describeDb('ListingResponseRunRepository (PostgreSQL integration, TEMP table)', () => {
  let ready = false;
  let tempReady = false;
  let pool: Pool;
  let client: PoolClient;
  let closePool: () => Promise<void>;

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../../config/database');
      pool = await db.getPool();
      closePool = db.closePool;
      client = await pool.connect();
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      ready = false;
    }
  });

  beforeEach(async () => {
    tempReady = false;
    if (!ready) return;
    await client.query('DROP TABLE IF EXISTS pg_temp.listing_response_runs');
    await client.query(`
      CREATE TEMP TABLE listing_response_runs (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL,
        product_id UUID NOT NULL,
        listing_id UUID NOT NULL,
        graph_version VARCHAR(40) NOT NULL,
        status VARCHAR(20) NOT NULL,
        stage VARCHAR(30),
        signal JSONB,
        probes JSONB NOT NULL DEFAULT '[]'::jsonb,
        findings JSONB NOT NULL DEFAULT '[]'::jsonb,
        fingerprint VARCHAR(64) NOT NULL,
        error_code VARCHAR(60),
        queued_at TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        lease_until TIMESTAMP
      )
    `);
    await client.query(
      `CREATE UNIQUE INDEX ux_lrr_one_active ON listing_response_runs(listing_id) WHERE status IN ('queued', 'running')`,
    );
    const persistence = await client.query<{ relpersistence: string }>(
      `SELECT relpersistence FROM pg_class WHERE oid = 'listing_response_runs'::regclass`,
    );
    if (persistence.rows[0]?.relpersistence !== 't') throw new Error('listing_response_runs is not the TEMP copy');
    tempReady = true;
  });

  afterEach(async () => {
    if (ready) await client.query('DROP TABLE IF EXISTS pg_temp.listing_response_runs');
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  const repo = () => new ListingResponseRunRepository(pool, client);
  const queue = (id = RUN, listingId = LISTING, productId = PID, queuedAt = NOW, workspaceId = WS) =>
    repo().insertQueued({
      id,
      workspaceId,
      productId,
      listingId,
      graphVersion: 'listing-response@test',
      fingerprint: 'fp',
      queuedAt,
    });
  const completeFields = (completedAt: string) => ({
    stage: 'seen_not_contacted' as const,
    signal: SIGNAL,
    probes: PROBES,
    findings: FINDINGS,
    completedAt,
  });

  it('a second insertQueued for the same listing returns null', async () => {
    if (!tempReady) return;
    await expect(queue()).resolves.toMatchObject({ id: RUN, status: 'queued', listingId: LISTING, stage: null });
    await expect(queue(RUN_2)).resolves.toBeNull();
    await expect(repo().findActive(WS, LISTING)).resolves.toMatchObject({ id: RUN });
  });

  it('claim moves queued to running once', async () => {
    if (!tempReady) return;
    await queue();
    await expect(repo().claim(RUN, later(1), later(6))).resolves.toMatchObject({ id: RUN, status: 'running' });
    await expect(repo().claim(RUN, later(2), later(7))).resolves.toBeNull();
  });

  it('complete stores findings and probes that findLatestCompleted returns unchanged', async () => {
    if (!tempReady) return;
    await queue();
    await repo().claim(RUN, later(1), later(6));
    await expect(repo().complete(RUN, completeFields(later(2)))).resolves.toBe(true);

    const stored = await repo().findLatestCompleted(WS, LISTING);
    expect(stored).toMatchObject({ id: RUN, status: 'completed', stage: 'seen_not_contacted', fingerprint: 'fp' });
    expect(stored?.findings).toEqual(FINDINGS);
    expect(stored?.probes).toEqual(PROBES);
    expect(stored?.signal).toEqual(SIGNAL);
    expect(stored?.completedAt).toBe(later(2));
    expect(stored?.createdAt).toBe(NOW);
    await expect(repo().findActive(WS, LISTING)).resolves.toBeNull();
  });

  it('complete on a failed run returns false', async () => {
    if (!tempReady) return;
    await queue();
    await expect(repo().fail(RUN, later(1), 'enqueue_failed')).resolves.toBe(true);

    await expect(repo().complete(RUN, completeFields(later(2)))).resolves.toBe(false);
    await expect(repo().findById(WS, RUN)).resolves.toMatchObject({ status: 'failed', errorCode: 'enqueue_failed' });
  });

  it('failExpired fails a running run past its lease', async () => {
    if (!tempReady) return;
    await queue();
    await repo().claim(RUN, later(1), later(6));

    await expect(repo().failExpired(WS, LISTING, later(5), later(-60), 'lease_expired')).resolves.toBe(false);
    await expect(repo().failExpired(WS, LISTING, later(7), later(-60), 'lease_expired')).resolves.toBe(true);
    await expect(repo().findById(WS, RUN)).resolves.toMatchObject({ status: 'failed', errorCode: 'lease_expired' });
  });

  it('failExpired fails a queued run older than queuedBefore', async () => {
    if (!tempReady) return;
    await queue();

    await expect(repo().failExpired(WS, LISTING, later(10), later(-1), 'job_lost')).resolves.toBe(false);
    await expect(repo().failExpired(WS, LISTING, later(10), later(1), 'job_lost')).resolves.toBe(true);
    await expect(repo().findById(WS, RUN)).resolves.toMatchObject({ status: 'failed', errorCode: 'job_lost' });
  });

  it('findNewest returns the newest run by queued_at whatever its status', async () => {
    if (!tempReady) return;
    await queue(RUN, LISTING, PID, NOW);
    await repo().complete(RUN, completeFields(later(1)));
    await queue(RUN_2, LISTING, PID, later(10));
    await repo().fail(RUN_2, later(11), 'enqueue_failed');

    await expect(repo().findNewest(WS, LISTING)).resolves.toMatchObject({ id: RUN_2, status: 'failed' });
    await expect(repo().findLatestCompleted(WS, LISTING)).resolves.toMatchObject({ id: RUN });
  });

  it('findLatestCompletedForProducts returns the newest completed run per product and skips failed-only products', async () => {
    if (!tempReady) return;
    await queue(RUN, LISTING, PID, NOW);
    await repo().complete(RUN, completeFields(later(1)));
    await queue(RUN_2, LISTING, PID, later(10));
    await repo().complete(RUN_2, completeFields(later(11)));
    await queue(RUN_3, LISTING_2, PID_2, later(20));
    await repo().fail(RUN_3, later(21), 'enqueue_failed');

    const latest = await repo().findLatestCompletedForProducts(WS, [PID, PID_2]);

    expect([...latest.keys()]).toEqual([PID]);
    expect(latest.get(PID)?.id).toBe(RUN_2);
    await expect(repo().findLatestCompletedForProducts(WS, [])).resolves.toEqual(new Map());
  });

  it('does not return rows of another workspace', async () => {
    if (!tempReady) return;
    await queue();
    await repo().complete(RUN, completeFields(later(1)));

    await expect(repo().findById(OTHER_WS, RUN)).resolves.toBeNull();
    await expect(repo().findLatestCompleted(OTHER_WS, LISTING)).resolves.toBeNull();
    await expect(repo().findNewest(OTHER_WS, LISTING)).resolves.toBeNull();
    await expect(repo().findActive(OTHER_WS, LISTING)).resolves.toBeNull();
    await expect(repo().findLatestCompletedForProducts(OTHER_WS, [PID])).resolves.toEqual(new Map());
  });
});
