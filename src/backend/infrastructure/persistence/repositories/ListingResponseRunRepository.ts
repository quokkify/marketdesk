import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type {
  CompletedListingResponseFields,
  IListingResponseRunRepository,
  NewListingResponseRun,
} from '../../../domain/repositories/interfaces/IListingResponseRunRepository';
import type {
  ListingResponseRun,
  ListingResponseSignal,
  ResponseFinding,
  ResponseStage,
  VerdictRunStatus,
} from '../../../../shared/types';

// Timestamps are stored as UTC wall time: written from an ISO instant, read back as one.
const ISO_INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string): string => `to_char(${column}, ${ISO_INSTANT}) AS ${column}`;
const UTC = (param: string): string => `(${param}::timestamptz AT TIME ZONE 'UTC')`;
const COLUMNS = `id, product_id, listing_id, graph_version, status, stage, signal, probes, findings, fingerprint, error_code,
  ${iso('queued_at')}, ${iso('completed_at')}`;

interface RunRow {
  id: string;
  product_id: string;
  listing_id: string;
  graph_version: string;
  status: VerdictRunStatus;
  stage: ResponseStage | null;
  signal: ListingResponseSignal | null;
  probes: ListingResponseRun['probes'];
  findings: ResponseFinding[];
  fingerprint: string;
  error_code: string | null;
  queued_at: string;
  completed_at: string | null;
}

function toRun(row: RunRow): ListingResponseRun {
  return {
    id: row.id,
    productId: row.product_id,
    listingId: row.listing_id,
    graphVersion: row.graph_version,
    status: row.status,
    stage: row.stage,
    signal: row.signal,
    probes: row.probes,
    findings: row.findings,
    fingerprint: row.fingerprint,
    errorCode: row.error_code,
    createdAt: row.queued_at,
    completedAt: row.completed_at,
  };
}

export class ListingResponseRunRepository implements IListingResponseRunRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  // The partial unique index on listing_id for queued and running runs turns a second insert into nothing.
  async insertQueued(run: NewListingResponseRun): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `INSERT INTO listing_response_runs (id, workspace_id, product_id, listing_id, graph_version, fingerprint, status, queued_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', ${UTC('$7')})
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [run.id, run.workspaceId, run.productId, run.listingId, run.graphVersion, run.fingerprint, run.queuedAt],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findActive(workspaceId: string, listingId: string): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM listing_response_runs
       WHERE workspace_id = $1 AND listing_id = $2 AND status IN ('queued', 'running')`,
      [workspaceId, listingId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async claim(runId: string, startedAt: string, leaseUntil: string): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `UPDATE listing_response_runs
       SET status = 'running', started_at = ${UTC('$2')}, lease_until = ${UTC('$3')}
       WHERE id = $1 AND status = 'queued'
       RETURNING ${COLUMNS}`,
      [runId, startedAt, leaseUntil],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async complete(runId: string, fields: CompletedListingResponseFields): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE listing_response_runs
       SET status = 'completed', stage = $2, signal = $3::jsonb, probes = $4::jsonb, findings = $5::jsonb,
           completed_at = ${UTC('$6')}, lease_until = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [
        runId,
        fields.stage,
        JSON.stringify(fields.signal),
        JSON.stringify(fields.probes),
        JSON.stringify(fields.findings),
        fields.completedAt,
      ],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async fail(runId: string, completedAt: string, errorCode: string): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE listing_response_runs
       SET status = 'failed', error_code = $2, completed_at = ${UTC('$3')}, lease_until = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [runId, errorCode, completedAt],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async failExpired(
    workspaceId: string,
    listingId: string,
    now: string,
    queuedBefore: string,
    errorCode: string,
  ): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE listing_response_runs
       SET status = 'failed', error_code = $5, completed_at = ${UTC('$3')}, lease_until = NULL
       WHERE workspace_id = $1 AND listing_id = $2
         AND ((status = 'running' AND lease_until < ${UTC('$3')})
           OR (status = 'queued' AND queued_at < ${UTC('$4')}))`,
      [workspaceId, listingId, now, queuedBefore, errorCode],
      this.queryClient,
    );
    return rowCount > 0;
  }

  async findById(workspaceId: string, runId: string): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM listing_response_runs WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, runId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findLatestCompleted(workspaceId: string, listingId: string): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM listing_response_runs
       WHERE workspace_id = $1 AND listing_id = $2 AND status = 'completed'
       ORDER BY listing_response_runs.completed_at DESC, listing_response_runs.queued_at DESC
       LIMIT 1`,
      [workspaceId, listingId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findNewest(workspaceId: string, listingId: string): Promise<ListingResponseRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM listing_response_runs
       WHERE workspace_id = $1 AND listing_id = $2
       ORDER BY listing_response_runs.queued_at DESC, listing_response_runs.id DESC
       LIMIT 1`,
      [workspaceId, listingId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findLatestCompletedForProducts(
    workspaceId: string,
    productIds: string[],
  ): Promise<Map<string, ListingResponseRun>> {
    const latest = new Map<string, ListingResponseRun>();
    if (productIds.length === 0) return latest;
    const { rows } = await query<RunRow>(
      `SELECT DISTINCT ON (product_id) ${COLUMNS} FROM listing_response_runs
       WHERE workspace_id = $1 AND product_id = ANY($2::uuid[]) AND status = 'completed'
       ORDER BY product_id, listing_response_runs.completed_at DESC, listing_response_runs.queued_at DESC`,
      [workspaceId, productIds],
      this.queryClient,
    );
    for (const row of rows) latest.set(row.product_id, toRun(row));
    return latest;
  }
}
