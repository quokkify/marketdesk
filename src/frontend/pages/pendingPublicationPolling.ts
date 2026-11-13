// Follows a queued advert until OLX answers: refetch on an interval and stop when the listing
// leaves draft, carries the failure text the listings table shows, or the wait runs out.
// Free of React so the timing is tested with fake timers; the hook only wires it to a page.
import type { Listing } from '@shared/types';

export const PENDING_PUBLICATION_POLL_INTERVAL_MS = 5000;
export const PENDING_PUBLICATION_TIMEOUT_MS = 120000;

export type PendingPublicationStop =
  | { kind: 'settled' }
  | { kind: 'failed'; message: string }
  | { kind: 'timed_out' };

export interface PendingPublicationPoller {
  start: () => void;
  observe: (listing: Pick<Listing, 'status' | 'syncError'>) => void;
  dispose: () => void;
}

export function createPendingPublicationPoller({
  refetch,
  onStop,
  intervalMs = PENDING_PUBLICATION_POLL_INTERVAL_MS,
  timeoutMs = PENDING_PUBLICATION_TIMEOUT_MS,
}: {
  refetch: () => void;
  onStop: (stop: PendingPublicationStop) => void;
  intervalMs?: number;
  timeoutMs?: number;
}): PendingPublicationPoller {
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const clearTimers = () => {
    clearInterval(interval);
    clearTimeout(timeout);
    interval = undefined;
    timeout = undefined;
  };

  const stop = (reason: PendingPublicationStop) => {
    if (!running) return;
    running = false;
    clearTimers();
    onStop(reason);
  };

  return {
    start() {
      if (running) return;
      running = true;
      interval = setInterval(refetch, intervalMs);
      timeout = setTimeout(() => stop({ kind: 'timed_out' }), timeoutMs);
    },
    observe(listing) {
      if (!running) return;
      if (listing.syncError) stop({ kind: 'failed', message: listing.syncError });
      else if (listing.status !== 'draft') stop({ kind: 'settled' });
    },
    dispose() {
      running = false;
      clearTimers();
    },
  };
}
