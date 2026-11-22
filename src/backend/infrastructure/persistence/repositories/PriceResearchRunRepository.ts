import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type {
  FinishedRunFields,
  IPriceResearchRunRepository,
  NewResearchRun,
} from '../../../domain/repositories/interfaces/IPriceResearchRunRepository';
import type {
  AnchorTier,
  NodeStatus,
  ResearchNode,
  ResearchRun,
  RunOutcome,
  RunStatus,
  RunTrigger,
} from '../../../../shared/types';

// Timestamps are stored as UTC wall time: written from an ISO instant, read back as one.
const ISO_INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string): string => `to_char(${column}, ${ISO_INSTANT}) AS ${column}`;
const UTC = (param: string): string => `(${param}::timestamptz AT TIME ZONE 'UTC')`;
const COLUMNS = `id, workspace_id, product_id, trigger, status, nodes, outcome, failed_tiers, error_code,
  consecutive_failures, ${iso('queued_at')}, ${iso('started_at')}, ${iso('finished_at')}, ${iso('lease_until')},
  ${iso('next_auto_at')}`;

interface RunRow {
  id: string;
  workspace_id: string;
  product_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  nodes: Partial<Record<ResearchNode, NodeStatus>>;
  outcome: RunOutcome | null;
  failed_tiers: AnchorTier[];
  error_code: string | null;
  consecutive_failures: number;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  lease_until: string | null;
  next_auto_at: string | null;
}

function toRun(row: RunRow): ResearchRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    trigger: row.trigger,
    status: row.status,
    nodes: row.nodes,
    outcome: row.outcome,
    failedTiers: row.failed_tiers,
    errorCode: row.error_code,
    consecutiveFailures: row.consecutive_failures,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    leaseUntil: row.lease_until,
    nextAutoAt: row.next_auto_at,
  };
}

export class PriceResearchRunRepository implements IPriceResearchRunRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  // The partial unique index on product_id for queued and running runs turns a second insert into nothing.
  async insertQueued(run: NewResearchRun): Promise<ResearchRun | null> {
    const { rows } = await query<RunRow>(
      `INSERT INTO price_research_runs (id, workspace_id, product_id, trigger, status, queued_at)
       VALUES ($1, $2, $3, $4, 'queued', ${UTC('$5')})
       ON CONFLICT DO NOTHING
       RETURNING ${COLUMNS}`,
      [run.id, run.workspaceId, run.productId, run.trigger, run.queuedAt],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findActive(workspaceId: string, productId: string): Promise<ResearchRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM price_research_runs
       WHERE workspace_id = $1 AND product_id = $2 AND status IN ('queued', 'running')`,
      [workspaceId, productId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findLastFinished(workspaceId: string, productId: string): Promise<ResearchRun | null> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM price_research_runs
       WHERE workspace_id = $1 AND product_id = $2 AND status = 'finished'
       ORDER BY price_research_runs.finished_at DESC, price_research_runs.queued_at DESC
       LIMIT 1`,
      [workspaceId, productId],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async listForProduct(workspaceId: string, productId: string, limit: number): Promise<ResearchRun[]> {
    const { rows } = await query<RunRow>(
      `SELECT ${COLUMNS} FROM price_research_runs
       WHERE workspace_id = $1 AND product_id = $2
       ORDER BY price_research_runs.queued_at DESC
       LIMIT $3`,
      [workspaceId, productId, limit],
      this.queryClient,
    );
    return rows.map(toRun);
  }

  async claim(runId: string, startedAt: string, leaseUntil: string): Promise<ResearchRun | null> {
    const { rows } = await query<RunRow>(
      `UPDATE price_research_runs
       SET status = 'running', started_at = ${UTC('$2')}, lease_until = ${UTC('$3')}
       WHERE id = $1 AND status = 'queued'
       RETURNING ${COLUMNS}`,
      [runId, startedAt, leaseUntil],
      this.queryClient,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  // One key at a time, so parallel tier nodes never overwrite each other's status.
  async saveNode(runId: string, node: ResearchNode, status: NodeStatus): Promise<void> {
    await query(
      `UPDATE price_research_runs SET nodes = nodes || jsonb_build_object($2::text, $3::text)
       WHERE id = $1 AND status = 'running'`,
      [runId, node, status],
      this.queryClient,
    );
  }

  async finish(runId: string, fields: FinishedRunFields): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE price_research_runs
       SET status = 'finished', outcome = $2, nodes = $3::jsonb, failed_tiers = $4::jsonb, error_code = $5,
         consecutive_failures = $6, finished_at = ${UTC('$7')}, next_auto_at = ${UTC('$8')}, lease_until = NULL
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [
        runId,
        fields.outcome,
        JSON.stringify(fields.nodes),
        JSON.stringify(fields.failedTiers),
        fields.errorCode,
        fields.consecutiveFailures,
        fields.finishedAt,
        fields.nextAutoAt,
      ],
      this.queryClient,
    );
    return rowCount > 0;
  }
}
