// Wires the pending publication poller to a page; the timing lives in pendingPublicationPolling.ts.
import { useEffect, useRef, useState } from 'react';
import type { Listing } from '@shared/types';
import { createPendingPublicationPoller } from './pendingPublicationPolling.js';
import type { PendingPublicationPoller } from './pendingPublicationPolling.js';

interface PendingPublicationState {
  polling: boolean;
  timedOut: boolean;
  // The failure text when polling stopped because the publication failed.
  failure: string | null;
}

const IDLE: PendingPublicationState = { polling: false, timedOut: false, failure: null };

export function usePendingPublicationPolling(
  listingId: string | null,
  refetch: () => void,
  listing: Listing | undefined,
): PendingPublicationState {
  const [state, setState] = useState<PendingPublicationState>(IDLE);
  const refetchRef = useRef(refetch);
  const listingRef = useRef(listing);
  const pollerRef = useRef<PendingPublicationPoller | null>(null);

  useEffect(() => {
    refetchRef.current = refetch;
    listingRef.current = listing;
  }, [listing, refetch]);

  useEffect(() => {
    if (!listingId) {
      setState(IDLE);
      return;
    }
    const poller = createPendingPublicationPoller({
      refetch: () => refetchRef.current(),
      onStop: (stop) =>
        setState({
          polling: false,
          timedOut: stop.kind === 'timed_out',
          failure: stop.kind === 'failed' ? stop.message : null,
        }),
    });
    pollerRef.current = poller;
    setState({ polling: true, timedOut: false, failure: null });
    // The listing still holds its pre-publication state here, so its note is the baseline.
    const queued = listingRef.current;
    poller.start(queued?.id === listingId ? queued.syncError : null);
    return () => {
      poller.dispose();
      pollerRef.current = null;
    };
  }, [listingId]);

  useEffect(() => {
    if (listing && listing.id === listingId) pollerRef.current?.observe(listing);
  }, [listing, listingId]);

  return state;
}
