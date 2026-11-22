import type { Pool, PoolClient } from 'pg';
import { EventRepository } from '../EventRepository';
import { HermesEvent } from '../../../../domain/entities/HermesEvent';
import { unwrap } from '../../../../domain/testkit/support';
import type { HermesEventStatus, HermesEventType } from '../../../../../shared/types';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const WS = '00000000-0000-4000-8000-0000000000a1';
const OTHER_WS = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const PRICE_TYPES: HermesEventType[] = ['suggested_lower_price', 'suggested_higher_price', 'price_estimate_unavailable'];

function event(id: string, workspaceId: string, productId: string, type: HermesEventType, status: HermesEventStatus = 'pending_review'): HermesEvent {
  return unwrap(HermesEvent.create({
    id: `00000000-0000-4000-8000-0000000000${id}`,
    workspaceId,
    productId,
    type,
    severity: 'info',
    title: 't',
    proposedChange: type === 'suggested_better_title'
      ? { kind: 'title', field: 'title', from: 'Widget', to: 'Widget X' }
      : type === 'price_estimate_unavailable' ? null : { kind: 'price', field: 'price', from: 100, to: 90 },
    status,
    resolvedAt: status === 'dismissed' ? new Date() : null,
  }));
}

// Runs only against a session TEMP copy of hermes_events, never the real table.
describeDb('EventRepository.findPendingByProduct (PostgreSQL integration, TEMP table)', () => {
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
      await client.query('DROP TABLE IF EXISTS pg_temp.hermes_events');
      await client.query(`
        CREATE TEMP TABLE hermes_events (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          product_id UUID,
          type VARCHAR(100) NOT NULL,
          severity VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          detail TEXT,
          proposed_change JSONB,
          autonomy_decision VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP,
          idempotency_key VARCHAR(500),
          source VARCHAR(20)
        )
      `);
      const persistence = await client.query<{ relpersistence: string }>(
        `SELECT relpersistence FROM pg_class WHERE oid = 'hermes_events'::regclass`,
      );
      if (persistence.rows[0]?.relpersistence !== 't') throw new Error('hermes_events is not the TEMP copy');
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      ready = false;
    }
  });

  afterAll(async () => {
    if (ready) await client.query('DROP TABLE IF EXISTS pg_temp.hermes_events');
    client?.release();
    await closePool?.();
  });

  it("returns only the product's pending events of the given types in the workspace", async () => {
    if (!ready) return;
    const repo = new EventRepository(pool, client);
    await repo.saveAll([
      event('01', WS, P1, 'suggested_lower_price'),
      event('02', WS, P1, 'price_estimate_unavailable'),
      event('03', WS, P1, 'suggested_higher_price', 'dismissed'),
      event('04', WS, P1, 'suggested_better_title'),
      event('05', WS, P2, 'suggested_lower_price'),
      event('06', OTHER_WS, P1, 'suggested_lower_price'),
    ]);

    const found = await repo.findPendingByProduct(WS, P1, PRICE_TYPES);

    expect(found.map((e) => e.id.slice(-2)).sort()).toEqual(['01', '02']);
  });
});
