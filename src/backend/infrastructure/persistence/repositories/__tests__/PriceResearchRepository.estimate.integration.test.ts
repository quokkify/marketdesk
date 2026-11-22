import type { Pool, PoolClient } from 'pg';
import { PriceResearchRepository } from '../PriceResearchRepository';
import type { StoredPriceEstimate } from '../../../../../shared/types';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-000000000001';
const PID = '00000000-0000-4000-8000-000000000002';
const OLDER = '2026-11-21T10:00:00.000Z';
const NEWER = '2026-11-22T10:00:00.000Z';

function stored(startPrice: number, researchUpdatedAt: string | null): StoredPriceEstimate {
  return {
    estimate: { startPrice, floorPrice: startPrice, retailAnchor: null, usedRange: null, reasoning: 'r', confidence: 'medium' },
    estimatedAt: NEWER,
    hiddenReason: null,
    researchNote: null,
    researchUpdatedAt,
  };
}

// Runs only against a session TEMP copy of product_price_research, never the real table.
describeDb('PriceResearchRepository.saveEstimate guard (PostgreSQL integration, TEMP table)', () => {
  let ready = false;
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
    if (!ready) return;
    await client.query('DROP TABLE IF EXISTS pg_temp.product_price_research');
    await client.query(`
      CREATE TEMP TABLE product_price_research (
        product_id UUID PRIMARY KEY,
        workspace_id UUID NOT NULL,
        retail_price NUMERIC(12,2),
        retail_currency VARCHAR(3),
        retail_source VARCHAR(200),
        retail_checked_at DATE,
        comparables JSONB NOT NULL DEFAULT '[]'::jsonb,
        specs VARCHAR(300),
        dismissed_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_attempt_at TIMESTAMP,
        last_estimate JSONB,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const persistence = await client.query<{ relpersistence: string }>(
      `SELECT relpersistence FROM pg_class WHERE oid = 'product_price_research'::regclass`,
    );
    expect(persistence.rows[0]?.relpersistence).toBe('t');
  });

  afterAll(async () => {
    if (ready) await client.query('DROP TABLE IF EXISTS pg_temp.product_price_research');
    client?.release();
    await closePool?.();
  });

  async function seed(updatedAt: string): Promise<PriceResearchRepository> {
    await client.query(
      `INSERT INTO product_price_research (product_id, workspace_id, updated_at) VALUES ($1, $2, $3::timestamptz AT TIME ZONE 'UTC')`,
      [PID, WS, updatedAt],
    );
    return new PriceResearchRepository(pool, client);
  }

  it('older researchUpdatedAt does not overwrite', async () => {
    if (!ready) return;
    const repo = await seed(NEWER);
    await repo.saveEstimate(WS, PID, stored(70, NEWER));
    await repo.saveEstimate(WS, PID, stored(90, OLDER));
    await repo.saveEstimate(WS, PID, stored(95, null));

    const research = await repo.findByProduct(WS, PID);
    expect(research?.lastEstimate).toMatchObject({ researchUpdatedAt: NEWER, estimate: { startPrice: 70 } });
  });

  it('the same or a newer research version overwrites, and an old estimate without a version is the oldest', async () => {
    if (!ready) return;
    const repo = await seed(NEWER);
    await client.query(
      `UPDATE product_price_research SET last_estimate = $1::jsonb`,
      [JSON.stringify({ ...stored(50, null), researchUpdatedAt: undefined })],
    );
    await repo.saveEstimate(WS, PID, stored(60, OLDER));
    await repo.saveEstimate(WS, PID, stored(70, OLDER));
    expect((await repo.findByProduct(WS, PID))?.lastEstimate?.estimate.startPrice).toBe(70);
    await repo.saveEstimate(WS, PID, stored(80, NEWER));
    expect((await repo.findByProduct(WS, PID))?.lastEstimate?.estimate.startPrice).toBe(80);
  });

  it('does not move the research version', async () => {
    if (!ready) return;
    const repo = await seed(NEWER);
    await repo.saveEstimate(WS, PID, stored(70, NEWER));
    expect((await repo.findByProduct(WS, PID))?.updatedAt).toBe(NEWER);
  });

  it('reads an estimate stored before the version existed as computed from no research', async () => {
    if (!ready) return;
    const repo = await seed(NEWER);
    await client.query(
      `UPDATE product_price_research SET last_estimate = $1::jsonb`,
      [JSON.stringify({ ...stored(50, null), researchUpdatedAt: undefined })],
    );
    expect((await repo.findByProduct(WS, PID))?.lastEstimate?.researchUpdatedAt).toBeNull();
  });
});
