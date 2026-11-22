import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
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

  // With baseUpdatedAt the update applies only while the stored row still carries that stamp
  // (null: only while there is no row); otherwise nothing is written and null comes back.
  async upsert(
    workspaceId: string,
    research: Omit<PriceResearch, 'updatedAt' | 'specs' | 'lastAttemptAt' | 'lastEstimate'>,
    baseUpdatedAt?: string | null,
  ): Promise<PriceResearch | null> {
    const checkBase = baseUpdatedAt !== undefined;
    const base = baseUpdatedAt ? new Date(baseUpdatedAt).toISOString() : null;
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
         AND (NOT $9::boolean OR ${UPDATED_AT_ISO} IS NOT DISTINCT FROM $10::text)
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
        checkBase,
        base,
      ],
      this.queryClient,
    );
    const row = rows[0];
    return row ? toPriceResearch(row) : null;
  }

  // Leaves the retail fields and the dismissed list alone; the caller passes the already merged rows.
  async saveLadder(
    workspaceId: string,
    productId: string,
    ladder: { comparables: PriceComparable[]; specs: string | null; attemptedAt: string },
  ): Promise<PriceResearch> {
    const { rows } = await query<PriceResearchRow>(
      `INSERT INTO product_price_research (product_id, workspace_id, comparables, specs, last_attempt_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, ($5::timestamptz AT TIME ZONE 'UTC'), ${NOW_UTC})
       ON CONFLICT (product_id) DO UPDATE SET
         comparables = EXCLUDED.comparables,
         specs = EXCLUDED.specs,
         last_attempt_at = EXCLUDED.last_attempt_at,
         updated_at = ${NOW_UTC}
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id
       RETURNING ${COLUMNS}`,
      [productId, workspaceId, JSON.stringify(ladder.comparables), ladder.specs, ladder.attemptedAt],
      this.queryClient,
    );
    return toPriceResearch(rows[0]!);
  }

  async markAttempt(workspaceId: string, productId: string, attemptedAt: string): Promise<void> {
    await query(
      `INSERT INTO product_price_research (product_id, workspace_id, last_attempt_at, updated_at)
       VALUES ($1, $2, ($3::timestamptz AT TIME ZONE 'UTC'), ${NOW_UTC})
       ON CONFLICT (product_id) DO UPDATE SET
         last_attempt_at = EXCLUDED.last_attempt_at,
         updated_at = ${NOW_UTC}
       WHERE product_price_research.workspace_id = EXCLUDED.workspace_id`,
      [productId, workspaceId, attemptedAt],
      this.queryClient,
    );
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
