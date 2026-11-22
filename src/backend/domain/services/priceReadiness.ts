import type { PriceReadiness, PriceResearch, ResearchRun, StoredPriceEstimate } from '../../../shared/types';

export type { PriceReadiness };

const hasCheckedSubstitute = (research: PriceResearch): boolean =>
  research.comparables.some(
    (r) => (r.tier === 'substitute_new' || r.tier === 'substitute_used') && r.classChecked === true,
  );

/**
 * ready: the last run is `ok`, or `partial` with at least one class-checked substitute row, and the
 * stored estimate was computed from the current research. blocked: no stored ladder to price from
 * (no research, or the last run failed and left none). degraded: research exists but is not ready.
 */
export function priceReadiness(input: {
  lastRun: ResearchRun | null;
  research: PriceResearch | null;
  estimate: StoredPriceEstimate | null;
}): PriceReadiness {
  const { lastRun, research, estimate } = input;
  if (research === null || research.comparables.length === 0) return 'blocked';
  const runDelivered =
    lastRun?.outcome === 'ok' || (lastRun?.outcome === 'partial' && hasCheckedSubstitute(research));
  const estimateCurrent = estimate !== null && estimate.researchUpdatedAt === research.updatedAt;
  return runDelivered && estimateCurrent ? 'ready' : 'degraded';
}
