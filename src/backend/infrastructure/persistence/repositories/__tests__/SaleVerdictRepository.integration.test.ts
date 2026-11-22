import type { Pool, PoolClient } from 'pg';
import { SaleVerdictRepository } from '../SaleVerdictRepository';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-000000000601';
const PID = '00000000-0000-4000-8000-000000000701';
const RUN = '00000000-0000-4000-8000-000000000801';
const RESEARCH_RUN = '00000000-0000-4000-8000-000000000901';

const NOW = '2026-11-22T12:00:00.000Z';
const later = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

// Runs only against a session TEMP copy of product_sale_verdicts (without its product foreign key),
// never the real table. The repository is bound to the session's client.
describeDb('SaleVerdictRepository (PostgreSQL integration, TEMP table)', () => {
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
    await client.query('DROP TABLE IF EXISTS pg_temp.product_sale_verdicts');
    await client.query(`
      CREATE TEMP TABLE product_sale_verdicts (
        id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL,
        product_id UUID NOT NULL,
        listing_id UUID,
        graph_version VARCHAR(40) NOT NULL,
        scope TEXT[] NOT NULL,
        status VARCHAR(20) NOT NULL,
        overall VARCHAR(20),
        checks JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_code VARCHAR(60),
        research_run_id UUID,
        queued_at TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        lease_until TIMESTAMP
      )
    `);
    const persistence = await client.query<{ relpersistence: string }>(
      `SELECT relpersistence FROM pg_class WHERE oid = 'product_sale_verdicts'::regclass`,
    );
    if (persistence.rows[0]?.relpersistence !== 't') throw new Error('product_sale_verdicts is not the TEMP copy');
    tempReady = true;
  });

  afterEach(async () => {
    if (ready) await client.query('DROP TABLE IF EXISTS pg_temp.product_sale_verdicts');
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  const repo = () => new SaleVerdictRepository(pool, client);
  const queue = () =>
    repo().insertQueued({
      id: RUN,
      workspaceId: WS,
      productId: PID,
      graphVersion: 'sale-verdict@1',
      scope: ['price'],
      queuedAt: NOW,
    });

  it('a new run has researchRunId null and errorCode null', async () => {
    if (!tempReady) return;
    await expect(queue()).resolves.toMatchObject({ id: RUN, researchRunId: null, errorCode: null });
  });

  it('setResearchRun stores the id and findById returns it', async () => {
    if (!tempReady) return;
    await queue();

    await repo().setResearchRun(RUN, RESEARCH_RUN);

    await expect(repo().findById(WS, RUN)).resolves.toMatchObject({ id: RUN, researchRunId: RESEARCH_RUN });
  });

  it('a failed run returns its errorCode', async () => {
    if (!tempReady) return;
    await queue();
    await repo().fail(RUN, later(1), 'enqueue_failed');

    await expect(repo().findById(WS, RUN)).resolves.toMatchObject({ status: 'failed', errorCode: 'enqueue_failed' });
  });
});
