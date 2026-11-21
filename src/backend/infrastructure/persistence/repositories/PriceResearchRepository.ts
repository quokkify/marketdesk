import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import type { PriceComparable, PriceResearch } from '../../../../shared/types';

// NUMERIC arrives as a string and DATE as a local-time Date; format both in SQL/JS so the value is exact.
const COLUMNS = `product_id, retail_price, retail_currency, retail_source,
  to_char(retail_checked_at, 'YYYY-MM-DD') AS retail_checked_at, comparables, updated_at`;

interface PriceResearchRow {
  product_id: string;
  retail_price: string | null;
  retail_currency: string | null;
  retail_source: string | null;
  retail_checked_at: string | null;
  comparables: PriceComparable[];
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

  async upsert(workspaceId: string, research: Omit<PriceResearch, 'updatedAt'>): Promise<PriceResearch> {
    const { rows } = await query<PriceResearchRow>(
      `INSERT INTO product_price_research
         (product_id, workspace_id, retail_price, retail_currency, retail_source, retail_checked_at, comparables)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (product_id) DO UPDATE SET
         retail_price = EXCLUDED.retail_price,
         retail_currency = EXCLUDED.retail_currency,
         retail_source = EXCLUDED.retail_source,
         retail_checked_at = EXCLUDED.retail_checked_at,
         comparables = EXCLUDED.comparables,
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
      ],
      this.queryClient,
    );
    return toPriceResearch(rows[0]!);
  }
}
