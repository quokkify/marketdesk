import type { Pool, PoolClient } from 'pg';
import { PriceResearchRunRepository } from '../PriceResearchRunRepository';
import type { FinishedRunFields } from '../../../../domain/repositories/interfaces/IPriceResearchRunRepository';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-000000000301';
const OTHER_WS = '00000000-0000-4000-8000-000000000302';
const P1 = '00000000-0000-4000-8000-000000000401';
const P2 = '00000000-0000-4000-8000-000000000402';
const runId = (n: number): string => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;

const NOW = '2026-11-22T12:00:00.000Z';
const later = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

function finished(fields: Partial<FinishedRunFields> = {}): FinishedRunFields {
  return {
    outcome: 'ok',
    nodes: { identify: 'done', sameModelUsed: 'done' },
    failedTiers: [],
    errorCode: null,
    consecutiveFailures: 0,
    finishedAt: later(5),
    nextAutoAt: later(7 * 24 * 60),
    ...fields,
  };
}

// Runs only against a session TEMP copy of price_research_runs (with its partial unique index), never
// the real table. The repository is bound to the session's client.
describeDb('PriceResearchRunRepository (PostgreSQL integration, TEMP table)', () => {
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
    await client.query('DROP TABLE IF EXISTS pg_temp.price_research_runs');
    await client.query(`
      CREATE TEMP TABLE price_research_runs (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL,
        product_id UUID NOT NULL,
        trigger VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        nodes JSONB NOT NULL DEFAULT '{}'::jsonb,
        outcome VARCHAR(20),
        failed_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
        error_code VARCHAR(60),
        consecutive_failures INT NOT NULL DEFAULT 0,
        queued_at TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        lease_until TIMESTAMP,
        next_auto_at TIMESTAMP
      )
    `);
    const persistence = await client.query<{ relpersistence: string }>(
      `SELECT relpersistence FROM pg_class WHERE oid = 'price_research_runs'::regclass`,
    );
    if (persistence.rows[0]?.relpersistence !== 't') throw new Error('price_research_runs is not the TEMP copy');
    await client.query(
      `CREATE UNIQUE INDEX ux_price_research_runs_one_active ON price_research_runs(product_id) WHERE status IN ('queued', 'running')`,
    );
    tempReady = true;
  });

  afterEach(async () => {
    if (ready) await client.query('DROP TABLE IF EXISTS pg_temp.price_research_runs');
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  const repo = () => new PriceResearchRunRepository(pool, client);
  const queue = (n: number, productId = P1, queuedAt = NOW, workspaceId = WS) =>
    repo().insertQueued({ id: runId(n), workspaceId, productId, trigger: 'analyze', queuedAt });

  it('inserts a queued run and reads its instants back as ISO strings', async () => {
    if (!tempReady) return;
    await expect(queue(1)).resolves.toEqual({
      id: runId(1), workspaceId: WS, productId: P1, trigger: 'analyze', status: 'queued', nodes: {},
      outcome: null, failedTiers: [], errorCode: null, consecutiveFailures: 0, queuedAt: NOW,
      startedAt: null, finishedAt: null, leaseUntil: null, nextAutoAt: null,
    });
    await expect(repo().findActive(WS, P1)).resolves.toMatchObject({ id: runId(1), status: 'queued' });
  });

  it('inserts nothing while the product has a queued or running run (partial unique index)', async () => {
    if (!tempReady) return;
    await queue(1);
    await expect(queue(2)).resolves.toBeNull();
    await repo().claim(runId(1), later(1), later(11));
    await expect(queue(3)).resolves.toBeNull();
    await expect(queue(4, P2)).resolves.toMatchObject({ id: runId(4) });

    await repo().finish(runId(1), finished());

    await expect(queue(5)).resolves.toMatchObject({ id: runId(5), status: 'queued' });
  });

  it('claims a queued run once, with its start and lease', async () => {
    if (!tempReady) return;
    await queue(1);

    await expect(repo().claim(runId(1), later(1), later(11))).resolves.toMatchObject({
      status: 'running', startedAt: later(1), leaseUntil: later(11),
    });
    await expect(repo().claim(runId(1), later(2), later(12))).resolves.toBeNull();
  });

  it('merges node progress one key at a time, only while running', async () => {
    if (!tempReady) return;
    await queue(1);
    await repo().saveNode(runId(1), 'identify', 'running');
    expect((await repo().findActive(WS, P1))?.nodes).toEqual({});

    await repo().claim(runId(1), later(1), later(11));
    await repo().saveNode(runId(1), 'identify', 'done');
    await repo().saveNode(runId(1), 'sameModelUsed', 'running');

    expect((await repo().findActive(WS, P1))?.nodes).toEqual({ identify: 'done', sameModelUsed: 'running' });
  });

  it('finishes a run once and reads it back as the last finished run', async () => {
    if (!tempReady) return;
    await queue(1);
    await repo().claim(runId(1), later(1), later(11));
    const fields = finished({ outcome: 'partial', failedTiers: ['substitute_used'], errorCode: null, consecutiveFailures: 0 });

    await expect(repo().finish(runId(1), fields)).resolves.toBe(true);
    await expect(repo().finish(runId(1), finished({ outcome: 'failed', errorCode: 'lease_expired' }))).resolves.toBe(false);

    await expect(repo().findActive(WS, P1)).resolves.toBeNull();
    await expect(repo().findLastFinished(WS, P1)).resolves.toMatchObject({
      id: runId(1), status: 'finished', outcome: 'partial', nodes: fields.nodes, failedTiers: ['substitute_used'],
      errorCode: null, consecutiveFailures: 0, finishedAt: later(5), nextAutoAt: later(7 * 24 * 60), leaseUntil: null,
    });
  });

  it('reads the latest finished run by its finish time, in the workspace only', async () => {
    if (!tempReady) return;
    await queue(1);
    await repo().finish(runId(1), finished({ finishedAt: later(30) }));
    await queue(2, P1, later(10));
    await repo().finish(runId(2), finished({ finishedAt: later(20), outcome: 'failed', errorCode: 'job_lost', nextAutoAt: null }));

    await expect(repo().findLastFinished(WS, P1)).resolves.toMatchObject({ id: runId(1), finishedAt: later(30) });
    await expect(repo().findLastFinished(OTHER_WS, P1)).resolves.toBeNull();
  });

  it('counts the workspace runs queued at or after a time', async () => {
    if (!tempReady) return;
    await queue(1, P1, later(-90));
    await queue(2, P2, NOW);
    await queue(3, '00000000-0000-4000-8000-000000000403', later(5));
    await queue(4, '00000000-0000-4000-8000-000000000404', NOW, OTHER_WS);
    await repo().claim(runId(3), later(6), later(16));

    await expect(repo().countQueued(WS, later(-60))).resolves.toBe(1);
    await expect(repo().countQueued(WS, later(-120))).resolves.toBe(2);
  });
});
