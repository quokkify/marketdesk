// When the next automatic price research run is due, by the outcome of the last one. A seller's
// Find prices ignores it.
import type { RunOutcome } from '../../../shared/types';

const HOUR_MS = 60 * 60 * 1000;
const OK_WAIT_MS = 7 * 24 * HOUR_MS;
const PARTIAL_WAIT_MS = 24 * HOUR_MS;
const FIRST_FAILURE_WAIT_MS = HOUR_MS;
const MAX_FAILURE_WAIT_MS = 24 * HOUR_MS;

export function nextAutoAt(outcome: RunOutcome, consecutiveFailures: number, finishedAt: Date): Date {
  const waitMs = outcome === 'ok'
    ? OK_WAIT_MS
    : outcome === 'partial'
      ? PARTIAL_WAIT_MS
      : Math.min(FIRST_FAILURE_WAIT_MS * 2 ** (Math.max(consecutiveFailures, 1) - 1), MAX_FAILURE_WAIT_MS);
  return new Date(finishedAt.getTime() + waitMs);
}
