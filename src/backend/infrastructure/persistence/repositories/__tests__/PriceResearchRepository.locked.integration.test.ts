import type { Pool, PoolClient } from 'pg';
import { PriceResearchRepository } from '../PriceResearchRepository';
import { NotFoundError } from '../../../../domain/shared/DomainError';
import type { PriceComparable } from '../../../../../shared/types';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-000000000101';
const OTHER_WS = '00000000-0000-4000-8000-000000000102';
const PID = '00000000-0000-4000-8000-000000000201';
const MISSING_PID = '00000000-0000-4000-8000-000000000202';
const TEMP_TABLES = ['products', 'product_price_research'];

const row = (price: number): PriceComparable => ({ price, note: 'same model, used', source: 'auto', tier: 'same_model_used' });

const edit = {
  retailPrice: 469.99,
  retailCurrency: 'PLN',
  retailSource: 'MediaMarkt',
  retailCheckedAt: '2026-11-21',
  comparables: [row(250)],
  dismissedUrls: [],
};

// Runs only against session TEMP copies of products and product_price_research, never the real
// tables. The repository is bound to the session's client, so it runs inside that session.
describeDb('PriceResearchRepository locked saves (PostgreSQL integration, TEMP tables)', () => {
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
    for (const table of TEMP_TABLES) await client.query(`DROP TABLE IF EXISTS pg_temp.${table}`);
    await client.query('CREATE TEMP TABLE products (id UUID PRIMARY KEY, workspace_id UUID NOT NULL)');
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
    for (const table of TEMP_TABLES) {
      const persistence = await client.query<{ relpersistence: string }>(
        `SELECT relpersistence FROM pg_class WHERE oid = $1::regclass`,
        [table],
      );
      if (persistence.rows[0]?.relpersistence !== 't') throw new Error(`${table} is not the TEMP copy`);
    }
    await client.query('INSERT INTO products (id, workspace_id) VALUES ($1, $2)', [PID, WS]);
    tempReady = true;
  });

  afterEach(async () => {
    if (!ready) return;
    await client.query('ROLLBACK').catch(() => undefined);
    for (const table of TEMP_TABLES) await client.query(`DROP TABLE IF EXISTS pg_temp.${table}`);
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  const repo = () => new PriceResearchRepository(pool, client);

  it('saveLadderLocked creates the row of an existing product, then updates it', async () => {
    if (!tempReady) return;
    const created = await repo().saveLadderLocked(WS, PID, (current) => {
      expect(current).toBeNull();
      return { comparables: [row(250)], specs: '1080p' };
    });
    expect(created).toMatchObject({ productId: PID, comparables: [row(250)], specs: '1080p', retailPrice: null });

    const updated = await repo().saveLadderLocked(WS, PID, (current) => {
      expect(current?.comparables).toEqual([row(250)]);
      return { comparables: [row(240)], specs: null };
    });
    expect(updated).toMatchObject({ comparables: [row(240)], specs: null });
    expect((await repo().findByProduct(WS, PID))?.comparables).toEqual([row(240)]);
  });

  it('saveLadderLocked returns the stored research when apply writes nothing', async () => {
    if (!tempReady) return;
    await repo().saveLadderLocked(WS, PID, () => ({ comparables: [row(250)], specs: null }));

    const kept = await repo().saveLadderLocked(WS, PID, () => null);

    expect(kept?.comparables).toEqual([row(250)]);
  });

  it('saveLadderLocked is a no-op for a missing product or another workspace', async () => {
    if (!tempReady) return;
    let called = false;
    const apply = () => {
      called = true;
      return { comparables: [row(250)], specs: null };
    };

    await expect(repo().saveLadderLocked(WS, MISSING_PID, apply)).resolves.toBeNull();
    await expect(repo().saveLadderLocked(OTHER_WS, PID, apply)).resolves.toBeNull();

    expect(called).toBe(false);
    const { rows } = await client.query('SELECT product_id FROM product_price_research');
    expect(rows).toEqual([]);
  });

  it('saveEditLocked writes the retail fields and the ladder and keeps specs', async () => {
    if (!tempReady) return;
    await repo().saveLadderLocked(WS, PID, () => ({ comparables: [row(250)], specs: '1080p' }));

    const saved = await repo().saveEditLocked(WS, PID, () => ({ ...edit, comparables: [row(260)] }));

    expect(saved).toMatchObject({
      retailPrice: 469.99, retailCurrency: 'PLN', retailSource: 'MediaMarkt', retailCheckedAt: '2026-11-21',
      comparables: [row(260)], specs: '1080p', dismissedUrls: [],
    });
  });

  it('saveEditLocked answers not found for a missing product', async () => {
    if (!tempReady) return;
    await expect(repo().saveEditLocked(WS, MISSING_PID, () => edit)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('moves updated_at forward for every save, even inside one transaction', async () => {
    if (!tempReady) return;
    await client.query('BEGIN');
    const first = await repo().saveLadderLocked(WS, PID, () => ({ comparables: [row(250)], specs: null }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repo().saveEditLocked(WS, PID, () => edit);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = await repo().saveLadderLocked(WS, PID, () => ({ comparables: [row(240)], specs: null }));
    await client.query('ROLLBACK');

    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
    expect(Date.parse(third!.updatedAt)).toBeGreaterThan(Date.parse(second.updatedAt));
  });
});
