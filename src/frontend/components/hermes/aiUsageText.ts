// Copy for AI usage and Hermes limits. Unknown is never shown as 0: a missing token count reads
// "usage not reported", and a limits reading that cannot be trusted says so.
import type { AiUsageSummary, AiUsageTotals, HermesLimits } from '@shared/types';

export const LIMITS_SCOPE_CAPTION = 'account-wide, shared with all Hermes use';
export const LIMITS_UNAVAILABLE = 'Limits unavailable';
export const USAGE_NOT_REPORTED = 'usage not reported';

const WARNING_PERCENT = 80;
const ERROR_PERCENT = 100;
const SECONDS_PER_MINUTE = 60;

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

/** The one line under a result that says what the analysis cost. Empty when nothing was recorded. */
export function aiUsageLine(usage: AiUsageSummary | undefined): string {
  if (!usage || usage.provider === 'none') return '';
  if (usage.provider === 'offline') return 'Offline heuristics · no AI usage';
  if (usage.promptTokens === null || usage.completionTokens === null) {
    return `Hermes · ${USAGE_NOT_REPORTED}`;
  }
  const tokens = `Hermes · ${formatTokens(usage.promptTokens)} in / ${formatTokens(usage.completionTokens)} out tokens`;
  return usage.costStatus === 'included' ? `${tokens} · included in subscription` : tokens;
}

export interface LimitBar {
  label: string;
  percent: number | null;
  resetsAt: string | null;
  tone: 'ok' | 'warning' | 'error';
}

export function limitsView(limits: HermesLimits): { bars: LimitBar[]; note: string } {
  if (limits.state === 'unknown' || limits.state === 'not_configured') {
    return {
      bars: [],
      note: limits.reason ? `${LIMITS_UNAVAILABLE} — ${limits.reason}` : LIMITS_UNAVAILABLE,
    };
  }
  const bars = limits.windows.map((w): LimitBar => ({
    label: w.label,
    percent: w.usedPercent,
    resetsAt: w.resetsAt,
    tone:
      w.usedPercent !== null && w.usedPercent >= ERROR_PERCENT
        ? 'error'
        : w.usedPercent !== null && w.usedPercent >= WARNING_PERCENT
          ? 'warning'
          : 'ok',
  }));
  const minutes = Math.round((limits.ageSeconds ?? 0) / SECONDS_PER_MINUTE);
  return {
    bars,
    note: limits.state === 'stale' ? `checked ${minutes} min ago — may be out of date` : '',
  };
}

/** Token total of a usage report, or the honest "not reported". */
export function totalTokensText(totals: Pick<AiUsageTotals, 'totalTokens'>): string {
  return totals.totalTokens === null
    ? USAGE_NOT_REPORTED
    : `${formatTokens(totals.totalTokens)} tokens`;
}
