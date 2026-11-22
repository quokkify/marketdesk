// When the next automatic price research run is due, by the outcome of the last one. A seller's
// Find prices ignores it.
import type { RunOutcome } from '../../../shared/types';

const HOUR_MS = 60 * 60 * 1000;
// After an ok run, and after a refusal that will not change by itself (a name with nothing to search).
export const RECHECK_WAIT_MS = 7 * 24 * HOUR_MS;
const PARTIAL_WAIT_MS = 24 * HOUR_MS;
const FIRST_FAILURE_WAIT_MS = HOUR_MS;
const MAX_FAILURE_WAIT_MS = 24 * HOUR_MS;

export function nextAutoAt(outcome: RunOutcome, consecutiveFailures: number, finishedAt: Date): Date {
  const waitMs = outcome === 'ok'
    ? RECHECK_WAIT_MS
    : outcome === 'partial'
      ? PARTIAL_WAIT_MS
      : Math.min(FIRST_FAILURE_WAIT_MS * 2 ** (Math.max(consecutiveFailures, 1) - 1), MAX_FAILURE_WAIT_MS);
  return new Date(finishedAt.getTime() + waitMs);
}

// Whether automatic research is due: after the last finished run's nextAutoAt. A product with no runs
// yet that was researched before runs existed waits the ok-run interval from that attempt, so the
// first automatic requests after the change do not research every product at once.
export function researchDue(
  last: { nextAutoAt: string | null } | null,
  lastAttemptAt: string | null | undefined,
  now: Date,
): boolean {
  if (last) return !last.nextAutoAt || now.getTime() >= Date.parse(last.nextAutoAt);
  return !(typeof lastAttemptAt === 'string' && now.getTime() - Date.parse(lastAttemptAt) < RECHECK_WAIT_MS);
}
