import type { Pool, PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { AiCallRecord } from '../../../application/ai/AiCallRecord';
import type {
  AiCostStatus,
  AiUsageReport,
  AiUsageReportCostStatus,
  AiUsageTotals,
} from '../../../../shared/types';

const LAST_DAYS = 7;
// Wider than LAST_DAYS so that any timezone offset still sees every local day of the window.
const SCAN_DAYS = LAST_DAYS + 2;

// Rows of one workspace whose local calendar day falls in the last $4 days ending today.
// $1 workspace, $2 timezone, $3 now, $4 window length in days.
const WINDOW_ROWS = `
  WITH day AS (SELECT (($3::timestamptz) AT TIME ZONE $2)::date AS today),
  r AS (
    SELECT u.*, (u.created_at AT TIME ZONE $2)::date AS local_day
    FROM ai_usage u
    WHERE u.workspace_id = $1 AND u.created_at >= $3::timestamptz - make_interval(days => ${SCAN_DAYS})
  )
`;
const IN_WINDOW = `r.local_day > day.today - $4::int AND r.local_day <= day.today`;

interface TotalsRow {
  analyses: string;
  hermes_analyses: string;
  offline_analyses: string;
  failed_analyses: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
}

interface FeatureRow {
  feature: string;
  analyses: string;
  total_tokens: string | null;
}

const toNumberOrNull = (value: string | null): number | null => (value === null ? null : Number(value));

function toTotals(row: TotalsRow): AiUsageTotals {
  return {
    analyses: Number(row.analyses),
    hermesAnalyses: Number(row.hermes_analyses),
    offlineAnalyses: Number(row.offline_analyses),
    failedAnalyses: Number(row.failed_analyses),
    promptTokens: toNumberOrNull(row.prompt_tokens),
    completionTokens: toNumberOrNull(row.completion_tokens),
    totalTokens: toNumberOrNull(row.total_tokens),
  };
}

// all included -> included; all not_applicable -> not_applicable; no rows or only unknown -> unknown;
// anything else (a mix of two or more statuses) -> mixed.
export function reportCostStatus(statuses: AiCostStatus[]): AiUsageReportCostStatus {
  const distinct = new Set(statuses);
  if (distinct.size === 0) return 'unknown';
  if (distinct.size === 1) return [...distinct][0]!;
  return 'mixed';
}

export class AiUsageRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  async insert(r: AiCallRecord & { workspaceId: string }): Promise<void> {
    await query(
      `INSERT INTO ai_usage
         (workspace_id, analysis_id, run_id, feature, operation, product_id, provider, model,
          prompt_tokens, completion_tokens, total_tokens, cost_status, latency_ms, outcome,
          http_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        r.workspaceId,
        r.analysisId ?? null,
        r.runId ?? null,
        r.feature ?? r.operation,
        r.operation,
        r.productId ?? null,
        r.provider,
        r.model,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.costStatus,
        Math.round(r.latencyMs),
        r.outcome,
        r.httpStatus,
        r.createdAt,
      ],
      this.queryClient,
    );
  }

  async summary(workspaceId: string, timezone: string, now: Date): Promise<AiUsageReport> {
    const [today, week, features, statuses] = await Promise.all([
      this.totals(workspaceId, timezone, now, 1),
      this.totals(workspaceId, timezone, now, LAST_DAYS),
      query<FeatureRow>(
        `${WINDOW_ROWS}
         SELECT r.feature, COUNT(DISTINCT r.analysis_id) AS analyses, SUM(r.total_tokens) AS total_tokens
         FROM r, day WHERE ${IN_WINDOW}
         GROUP BY r.feature ORDER BY r.feature`,
        [workspaceId, timezone, now, LAST_DAYS],
        this.queryClient,
      ),
      query<{ cost_status: AiCostStatus }>(
        `${WINDOW_ROWS}
         SELECT DISTINCT r.cost_status FROM r, day WHERE ${IN_WINDOW}`,
        [workspaceId, timezone, now, LAST_DAYS],
        this.queryClient,
      ),
    ]);
    return {
      timezone,
      today,
      last7Days: week,
      byFeature: features.rows.map((row) => ({
        feature: row.feature,
        analyses: Number(row.analyses),
        totalTokens: toNumberOrNull(row.total_tokens),
      })),
      costStatus: reportCostStatus(statuses.rows.map((row) => row.cost_status)),
    };
  }

  private async totals(workspaceId: string, timezone: string, now: Date, days: number): Promise<AiUsageTotals> {
    const { rows } = await query<TotalsRow>(
      `${WINDOW_ROWS}
       SELECT COUNT(DISTINCT r.analysis_id) AS analyses,
              COUNT(DISTINCT r.analysis_id) FILTER (WHERE r.provider = 'hermes') AS hermes_analyses,
              COUNT(DISTINCT r.analysis_id) FILTER (WHERE r.provider = 'offline') AS offline_analyses,
              COUNT(DISTINCT r.analysis_id) FILTER (WHERE r.outcome <> 'ok') AS failed_analyses,
              SUM(r.prompt_tokens) AS prompt_tokens,
              SUM(r.completion_tokens) AS completion_tokens,
              SUM(r.total_tokens) AS total_tokens
       FROM r, day WHERE ${IN_WINDOW}`,
      [workspaceId, timezone, now, days],
      this.queryClient,
    );
    return toTotals(rows[0]!);
  }
}
