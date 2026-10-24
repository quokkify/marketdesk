// A delist leaves a category correction operation that references the listing.
// Deleting the product cascades to the listing, so that reference must not block
// the delete (migration 043). The tables are session-only TEMP copies of the
// product delete path, so the test never changes the real schema or its rows.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProductRepository as ProductRepositoryType } from '../../../infrastructure/persistence/repositories/ProductRepository';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

function readMigration(name: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), 'src/backend/persistence/migrations', name),
    'utf8',
  );
}

describeDb('product delete after a listing delist (PostgreSQL integration)', () => {
  let ready = false;
  let pool: Pool;
  let client: PoolClient;
  let closePool: () => Promise<void>;
  let ProductRepository: typeof ProductRepositoryType;

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../config/database');
      pool = await db.getPool();
      closePool = db.closePool;
      client = await pool.connect();
      ({ ProductRepository } = await import('../../../infrastructure/persistence/repositories/ProductRepository'));
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      ready = false;
    }
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  // The foreign keys match schema.sql before migration 043. Unqualified names
  // resolve to the session's temporary tables first, and the check below refuses
  // to continue unless they do.
  beforeEach(async () => {
    if (!ready) return;
    await client.query(`
      DROP TABLE IF EXISTS pg_temp.category_correction_operations, pg_temp.listings, pg_temp.products;
      CREATE TEMP TABLE products (id uuid PRIMARY KEY, workspace_id uuid NOT NULL);
      CREATE TEMP TABLE listings (
        id uuid PRIMARY KEY,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
      );
      CREATE TEMP TABLE category_correction_operations (
        id uuid PRIMARY KEY,
        listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
        result jsonb
      );
    `);
    const tables = await client.query<{ relpersistence: string }>(`
      SELECT relpersistence FROM pg_class
       WHERE oid IN ('products'::regclass, 'listings'::regclass, 'category_correction_operations'::regclass)
    `);
    if (tables.rows.length !== 3 || tables.rows.some((row) => row.relpersistence !== 't')) {
      throw new Error('The product delete tables must resolve to session-scoped temporary tables');
    }
  });

  async function seedDelistedProduct() {
    const ids = {
      workspaceId: randomUUID(),
      productId: randomUUID(),
      listingId: randomUUID(),
      operationId: randomUUID(),
    };
    await client.query('INSERT INTO products (id, workspace_id) VALUES ($1, $2)', [ids.productId, ids.workspaceId]);
    await client.query('INSERT INTO listings (id, product_id) VALUES ($1, $2)', [ids.listingId, ids.productId]);
    // The executed delist stays as audit history after the listing returns to draft.
    await client.query(
      'INSERT INTO category_correction_operations (id, listing_id, result) VALUES ($1, $2, $3)',
      [ids.operationId, ids.listingId, JSON.stringify({ listingId: ids.listingId, productId: ids.productId })],
    );
    return ids;
  }

  it('refuses the product delete with a foreign key violation before migration 043', async () => {
    if (!ready) return;
    const seeded = await seedDelistedProduct();

    // PostgreSQL 18 reports ON DELETE RESTRICT as restrict_violation (23001);
    // earlier versions report foreign_key_violation (23503).
    await expect(
      new ProductRepository(pool, client).delete(seeded.productId, seeded.workspaceId),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23001|23503)$/) });
  });

  it('leaves the relaxed foreign key validated after a single run', async () => {
    if (!ready) return;
    await seedDelistedProduct();

    await client.query(readMigration('043_correction_operation_listing_set_null.sql'));

    const constraint = await client.query(`
      SELECT convalidated AS validated, confdeltype AS on_delete
        FROM pg_constraint
       WHERE conrelid = 'category_correction_operations'::regclass
         AND conname = 'category_correction_operations_listing_id_fkey'
    `);
    expect(constraint.rows).toEqual([{ validated: true, on_delete: 'n' }]);
  });

  it('deletes the product after migration 043 and keeps the delist audit row', async () => {
    if (!ready) return;
    const migration = readMigration('043_correction_operation_listing_set_null.sql');
    await client.query(migration);
    await client.query(migration);
    const seeded = await seedDelistedProduct();

    await new ProductRepository(pool, client).delete(seeded.productId, seeded.workspaceId);

    const remaining = await client.query(
      'SELECT (SELECT COUNT(*) FROM products)::int AS products, (SELECT COUNT(*) FROM listings)::int AS listings',
    );
    const operation = await client.query(
      'SELECT listing_id, result FROM category_correction_operations WHERE id = $1',
      [seeded.operationId],
    );
    const column = await client.query(`
      SELECT a.attnotnull AS not_null, c.confdeltype AS on_delete, COUNT(*) OVER ()::int AS constraints
        FROM pg_attribute a
        JOIN pg_constraint c ON c.conrelid = a.attrelid AND a.attnum = ANY (c.conkey)
       WHERE a.attrelid = 'category_correction_operations'::regclass
         AND a.attname = 'listing_id'
         AND c.contype = 'f'
    `);
    expect(remaining.rows).toEqual([{ products: 0, listings: 0 }]);
    expect(operation.rows).toEqual([
      { listing_id: null, result: { listingId: seeded.listingId, productId: seeded.productId } },
    ]);
    expect(column.rows).toEqual([{ not_null: false, on_delete: 'n', constraints: 1 }]);
  });
});
