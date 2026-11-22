import type { Pool, PoolClient } from 'pg';
import { getPool, query } from '../../../config/database';
import { NotFoundError } from '../../../domain/shared/DomainError';
import type {
  IPriceResearchRepository,
  PriceResearchEdit,
} from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import type { PriceComparable, PriceResearch, StoredPriceEstimate } from '../../../../shared/types';

// NUMERIC arrives as a string and DATE as a local-time Date; format both in SQL/JS so the value is exact.
// last_attempt_at and updated_at are stored as UTC wall time and formatted back to an ISO instant in SQL.
// updated_at is cut to milliseconds, the precision a client echoes back as baseUpdatedAt.
const ISO_INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const UPDATED_AT_ISO = `to_char(date_trunc('milliseconds', product_price_research.updated_at), ${ISO_INSTANT})`;
const NOW_UTC = `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
const COLUMNS = `product_id, retail_price, retail_currency, retail_source,
  to_char(retail_checked_at, 'YYYY-MM-DD') AS retail_checked_at, comparables, specs, dismissed_urls,
  to_char(last_attempt_at, ${ISO_INSTANT}) AS last_attempt_at, last_estimate, ${UPDATED_AT_ISO} AS updated_at`;

interface PriceResearchRow {
  product_id: string;
  retail_price: string | null;
  retail_currency: string | null;
  retail_source: string | null;
  retail_checked_at: string | null;
  comparables: PriceComparable[];
  specs: string | null;
  dismissed_urls: string[];
  last_attempt_at: string | null;
  last_estimate: StoredPriceEstimate | null;
  updated_at: string;
}

function toPriceResearch(row: PriceResearchRow): PriceResearch {
  return {
    productId: row.product_id,
    retailPrice: row.retail_price === null ? null : Number(row.retail_price),
    retailCurrency: row.retail_currency,
    retailSource: row.retail_source,
    retailCheckedAt: row.retail_checked_at,
    comparables: row.comparables,
    specs: row.specs,
    dismissedUrls: row.dismissed_urls,
    lastAttemptAt: row.last_attempt_at,
    lastEstimate: row.last_estimate,
    updatedAt: row.updated_at,
  };
}

export class PriceResearchRepository implements IPriceResearchRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(
    private readonly pool?: Pool,
    private readonly client?: PoolClient,
  ) {
    this.queryClient = client || pool;
  }

  async findByProduct(workspaceId: string, productId: string): Promise<PriceResearch | null> {
    const { rows } = await query<PriceResearchRow>(
      `SELECT ${COLUMNS} FROM product_price_research WHERE workspace_id = $1 AND product_id = $2`,
      [workspaceId, productId],
      this.queryClient,
    );
    const row = rows[0];
    return row ? toPriceResearch(row) : null;
  }

  async saveEditLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => PriceResearchEdit,
  ): Promise<PriceResearch> {
    const saved = await this.locked(workspaceId, productId, async (client, current) => {
      const research = apply(current);
      const { rows } = await query<PriceResearchRow>(
        `INSERT INTO product_price_research
           (product_id, workspace_id, retail_price, retail_currency, retail_source, retail_checked_at, comparables, dismissed_urls, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, ${NOW_UTC})
         ON CONFLICT (product_id) DO UPDATE SET
           retail_price = EXCLUDED.retail_price,
           retail_currency = EXCLUDED.retail_currency,
           retail_source = EXCLUDED.retail_source,
           retail_checked_at = EXCLUDED.retail_checked_at,
           comparables = EXCLUDED.comparables,
           dismissed_urls = EXCLUDED.dismissed_urls,
           updated_at = ${NOW_UTC}
         WHERE product_price_research.workspace_id = EXCLUDED.workspace_id
         RETURNING ${COLUMNS}`,
        [
          productId,
          workspaceId,
          research.retailPrice,
          research.retailCurrency,
          research.retailSource,
          research.retailCheckedAt,
          JSON.stringify(research.comparables),
          JSON.stringify(research.dismissedUrls),
        ],
        client,
      );
      const row = rows[0];
      if (!row) throw new Error(`Price research of product ${productId} could not be saved`);
      return toPriceResearch(row);
    });
    // The product was deleted (or is another workspace's) since the caller looked it up.
    if (!saved) throw new NotFoundError(`Product not found: ${productId}`);
    return saved;
  }

  // Leaves the retail fields, the dismissed list and the last attempt alone.
  async saveLadderLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => { comparables: PriceComparable[]; specs: string | null } | null,
  ): Promise<PriceResearch | null> {
    return this.locked(workspaceId, productId, async (client, current) => {
      const ladder = apply(current);
      if (!ladder) return current;
      const { rows } = await query<PriceResearchRow>(
        `INSERT INTO product_price_research (product_id, workspace_id, comparables, specs, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, ${NOW_UTC})
         ON CONFLICT (product_id) DO UPDATE SET
           comparables = EXCLUDED.comparables,
           specs = EXCLUDED.specs,
           updated_at = ${NOW_UTC}
         WHERE product_price_research.workspace_id = EXCLUDED.workspace_id
         RETURNING ${COLUMNS}`,
        [productId, workspaceId, JSON.stringify(ladder.comparables), ladder.specs],
        client,
      );
      return rows[0] ? toPriceResearch(rows[0]) : null;
    });
  }

  // Runs work in one transaction holding the research row with SELECT … FOR UPDATE. A missing row is
  // created first so the lock has something to hold, and handed to work as null; when work writes
  // nothing the transaction rolls back, so that placeholder never persists. A product that is gone
  // (or belongs to another workspace) gets null without running work.
  private async locked<T>(
    workspaceId: string,
    productId: string,
    work: (client: PoolClient | Pool, current: PriceResearch | null) => Promise<T>,
  ): Promise<T | null> {
    return this.inTransaction(async (client) => {
      const created = await query(
        `INSERT INTO product_price_research (product_id, workspace_id, updated_at)
         SELECT p.id, p.workspace_id, ${NOW_UTC} FROM products p WHERE p.id = $1 AND p.workspace_id = $2
         ON CONFLICT (product_id) DO NOTHING
         RETURNING product_id`,
        [productId, workspaceId],
        client,
      );
      const { rows } = await query<PriceResearchRow>(
        `SELECT ${COLUMNS} FROM product_price_research WHERE workspace_id = $1 AND product_id = $2 FOR UPDATE`,
        [workspaceId, productId],
        client,
      );
      const row = rows[0];
      if (!row) return { value: null, commit: false };
      const current = created.rowCount > 0 ? null : toPriceResearch(row);
      const value = await work(client, current);
      // Unchanged placeholder or no write by work: nothing to keep.
      return { value, commit: value !== current };
    });
  }

  private async inTransaction<T>(
    work: (client: PoolClient | Pool) => Promise<{ value: T; commit: boolean }>,
  ): Promise<T> {
    // A repository bound to a client runs inside its caller's transaction.
    if (this.client) return (await work(this.client)).value;
    const client = await (this.pool ?? (await getPool())).connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      const { value, commit } = await work(client);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // The original failure matters more; the broken connection is not returned to the pool.
        releaseError = rollbackError instanceof Error ? rollbackError : new Error('Rollback failed');
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async saveEstimate(workspaceId: string, productId: string, stored: StoredPriceEstimate): Promise<void> {
    await query(
      `INSERT INTO product_price_research (product_id, workspace_id, last_estimate, updated_at)
       VALUES ($1, $2, $3::jsonb, ${NOW_UTC})
       ON CONFLICT (product_id) DO UPDATE SET
         last_estimate = EXCLUDED.last_estimate,
         updated_at = ${NOW_UTC}
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id`,
      [productId, workspaceId, JSON.stringify(stored)],
      this.queryClient,
    );
  }
}
