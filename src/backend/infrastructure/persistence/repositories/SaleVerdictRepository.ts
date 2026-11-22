import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type {
  CompletedVerdictFields,
  ISaleVerdictRepository,
  NewVerdictRun,
} from '../../../domain/repositories/interfaces/ISaleVerdictRepository';
import type {
  SaleVerdict,
  VerdictCheck,
  VerdictCheckName,
  VerdictOverall,
  VerdictRunStatus,
} from '../../../../shared/types';

// Timestamps are stored as UTC wall time: written from an ISO instant, read back as one.
const ISO_INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string): string => `to_char(${column}, ${ISO_INSTANT}) AS ${column}`;
const UTC = (param: string): string => `(${param}::timestamptz AT TIME ZONE 'UTC')`;
const COLUMNS = `id, product_id, listing_id, graph_version, scope, status, overall, checks,
  ${iso('queued_at')}, ${iso('completed_at')}`;

interface VerdictRow {
  id: string;
  product_id: string;
  listing_id: string | null;
  graph_version: string;
  scope: VerdictCheckName[];
  status: VerdictRunStatus;
  overall: VerdictOverall | null;
  checks: Partial<Record<VerdictCheckName, VerdictCheck>>;
  queued_at: string;
  completed_at: string | null;
}

function toVerdict(row: VerdictRow): SaleVerdict {
  return {
    id: row.id,
    productId: row.product_id,
    listingId: row.listing_id,
    graphVersion: row.graph_version,
    scope: row.scope,
    status: row.status,
    overall: row.overall,
    checks: row.checks,
    createdAt: row.queued_at,
    completedAt: row.completed_at,
  };
}

export class SaleVerdictRepository implements ISaleVerdictRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  // The partial unique index on product_id for queued and running runs turns a second insert into nothing.
  async insertQueued(run: NewVerdictRun): Promise<SaleVerdict | null> {
    const { rows } = await query<VerdictRow>(
      `INSERT INTO product_sale_verdicts (id, workspace_id, product_id, graph_version, scope, status, queued_at)
       VALUES ($1, $2, $3, $4, $5::text[], 'queued', ${UTC('$6')})
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [run.id, run.workspaceId, run.productId, run.graphVersion, run.scope, run.queuedAt],
      this.queryClient,
    );
    return rows[0] ? toVerdict(rows[0]) : null;
  }

  async findActive(workspaceId: string, productId: string): Promise<SaleVerdict | null> {
    const { rows } = await query<VerdictRow>(
      `SELECT ${COLUMNS} FROM product_sale_verdicts
       WHERE workspace_id = $1 AND product_id = $2 AND status IN ('queued', 'running')`,
      [workspaceId, productId],
      this.queryClient,
    );
    return rows[0] ? toVerdict(rows[0]) : null;
  }

  async claim(runId: string, startedAt: string, leaseUntil: string): Promise<SaleVerdict | null> {
    const { rows } = await query<VerdictRow>(
      `UPDATE product_sale_verdicts
       SET status = 'running', started_at = ${UTC('$2')}, lease_until = ${UTC('$3')}
       WHERE id = $1 AND status = 'queued'
       RETURNING ${COLUMNS}`,
      [runId, startedAt, leaseUntil],
      this.queryClient,
    );
    return rows[0] ? toVerdict(rows[0]) : null;
  }

  async setListing(runId: string, listingId: string | null): Promise<void> {
    await query(
      `UPDATE product_sale_verdicts SET listing_id = $2 WHERE id = $1`,
      [runId, listingId],
      this.queryClient,
    );
  }

  async complete(runId: string, fields: CompletedVerdictFields): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE product_sale_verdicts
       SET status = 'completed', overall = $2, checks = $3::jsonb, completed_at = ${UTC('$4')}, lease_until = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [runId, fields.overall, JSON.stringify(fields.checks), fields.completedAt],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async fail(runId: string, completedAt: string, errorCode: string): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE product_sale_verdicts
       SET status = 'failed', error_code = $2, completed_at = ${UTC('$3')}, lease_until = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [runId, errorCode, completedAt],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async failExpired(
    workspaceId: string,
    productId: string,
    now: string,
    queuedBefore: string,
    errorCode: string,
  ): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE product_sale_verdicts
       SET status = 'failed', error_code = $5, completed_at = ${UTC('$3')}, lease_until = NULL
       WHERE workspace_id = $1 AND product_id = $2
         AND ((status = 'running' AND lease_until < ${UTC('$3')})
           OR (status = 'queued' AND queued_at < ${UTC('$4')}))`,
      [workspaceId, productId, now, queuedBefore, errorCode],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async findById(workspaceId: string, runId: string): Promise<SaleVerdict | null> {
    const { rows } = await query<VerdictRow>(
      `SELECT ${COLUMNS} FROM product_sale_verdicts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, runId],
      this.queryClient,
    );
    return rows[0] ? toVerdict(rows[0]) : null;
  }

  async findLatestCompleted(workspaceId: string, productId: string): Promise<SaleVerdict | null> {
    const { rows } = await query<VerdictRow>(
      `SELECT ${COLUMNS} FROM product_sale_verdicts
       WHERE workspace_id = $1 AND product_id = $2 AND status = 'completed'
       ORDER BY product_sale_verdicts.completed_at DESC, product_sale_verdicts.queued_at DESC
       LIMIT 1`,
      [workspaceId, productId],
      this.queryClient,
    );
    return rows[0] ? toVerdict(rows[0]) : null;
  }

  async findLatestCompletedForProducts(
    workspaceId: string,
    productIds: string[],
  ): Promise<Map<string, SaleVerdict>> {
    const latest = new Map<string, SaleVerdict>();
    if (productIds.length === 0) return latest;
    const { rows } = await query<VerdictRow>(
      `SELECT DISTINCT ON (product_id) ${COLUMNS} FROM product_sale_verdicts
       WHERE workspace_id = $1 AND product_id = ANY($2::uuid[]) AND status = 'completed'
       ORDER BY product_id, product_sale_verdicts.completed_at DESC, product_sale_verdicts.queued_at DESC`,
      [workspaceId, productIds],
      this.queryClient,
    );
    for (const row of rows) latest.set(row.product_id, toVerdict(row));
    return latest;
  }

  async lastRunFailed(workspaceId: string, productId: string): Promise<boolean> {
    const { rows } = await query<{ status: VerdictRunStatus }>(
      `SELECT status FROM product_sale_verdicts
       WHERE workspace_id = $1 AND product_id = $2
       ORDER BY queued_at DESC
       LIMIT 1`,
      [workspaceId, productId],
      this.queryClient,
    );
    return rows[0]?.status === 'failed';
  }
}
