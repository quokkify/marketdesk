import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import type { PriceComparable, PriceResearch, StoredPriceEstimate } from '../../../../shared/types';

// NUMERIC arrives as a string and DATE as a local-time Date; format both in SQL/JS so the value is exact.
// last_attempt_at is stored as UTC wall time and formatted back to an ISO instant in SQL.
const COLUMNS = `product_id, retail_price, retail_currency, retail_source,
  to_char(retail_checked_at, 'YYYY-MM-DD') AS retail_checked_at, comparables, specs, dismissed_urls,
  to_char(last_attempt_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_attempt_at, last_estimate, updated_at`;

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
  updated_at: Date;
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
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PriceResearchRepository implements IPriceResearchRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
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

  async upsert(
    workspaceId: string,
    research: Omit<PriceResearch, 'updatedAt' | 'specs' | 'lastAttemptAt' | 'lastEstimate'>,
  ): Promise<PriceResearch> {
    const { rows } = await query<PriceResearchRow>(
      `INSERT INTO product_price_research
         (product_id, workspace_id, retail_price, retail_currency, retail_source, retail_checked_at, comparables, dismissed_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (product_id) DO UPDATE SET
         retail_price = EXCLUDED.retail_price,
         retail_currency = EXCLUDED.retail_currency,
         retail_source = EXCLUDED.retail_source,
         retail_checked_at = EXCLUDED.retail_checked_at,
         comparables = EXCLUDED.comparables,
         dismissed_urls = EXCLUDED.dismissed_urls,
         updated_at = CURRENT_TIMESTAMP
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id
       RETURNING ${COLUMNS}`,
      [
        research.productId,
        workspaceId,
        research.retailPrice,
        research.retailCurrency,
        research.retailSource,
        research.retailCheckedAt,
        JSON.stringify(research.comparables),
        JSON.stringify(research.dismissedUrls),
      ],
      this.queryClient,
    );
    return toPriceResearch(rows[0]!);
  }

  // Leaves the retail fields and the dismissed list alone; the caller passes the already merged rows.
  async saveLadder(
    workspaceId: string,
    productId: string,
    ladder: { comparables: PriceComparable[]; specs: string | null; attemptedAt: string },
  ): Promise<PriceResearch> {
    const { rows } = await query<PriceResearchRow>(
      `INSERT INTO product_price_research (product_id, workspace_id, comparables, specs, last_attempt_at)
       VALUES ($1, $2, $3::jsonb, $4, ($5::timestamptz AT TIME ZONE 'UTC'))
       ON CONFLICT (product_id) DO UPDATE SET
         comparables = EXCLUDED.comparables,
         specs = EXCLUDED.specs,
         last_attempt_at = EXCLUDED.last_attempt_at,
         updated_at = CURRENT_TIMESTAMP
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id
       RETURNING ${COLUMNS}`,
      [productId, workspaceId, JSON.stringify(ladder.comparables), ladder.specs, ladder.attemptedAt],
      this.queryClient,
    );
    return toPriceResearch(rows[0]!);
  }

  async markAttempt(workspaceId: string, productId: string, attemptedAt: string): Promise<void> {
    await query(
      `INSERT INTO product_price_research (product_id, workspace_id, last_attempt_at)
       VALUES ($1, $2, ($3::timestamptz AT TIME ZONE 'UTC'))
       ON CONFLICT (product_id) DO UPDATE SET
         last_attempt_at = EXCLUDED.last_attempt_at
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id`,
      [productId, workspaceId, attemptedAt],
      this.queryClient,
    );
  }

  async saveEstimate(workspaceId: string, productId: string, stored: StoredPriceEstimate): Promise<void> {
    await query(
      `INSERT INTO product_price_research (product_id, workspace_id, last_estimate)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (product_id) DO UPDATE SET
         last_estimate = EXCLUDED.last_estimate
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id`,
      [productId, workspaceId, JSON.stringify(stored)],
      this.queryClient,
    );
  }
}
