// Wires the pending publication poller to a page; the timing lives in pendingPublicationPolling.ts.
import { useEffect, useRef, useState } from 'react';
import type { Listing } from '@shared/types';
import { createPendingPublicationPoller } from './pendingPublicationPolling.js';
import type { PendingPublicationPoller } from './pendingPublicationPolling.js';

export function usePendingPublicationPolling(
  listingId: string | null,
  refetch: () => void,
  listing: Listing | undefined,
): { polling: boolean; timedOut: boolean } {
  const [state, setState] = useState({ polling: false, timedOut: false });
  const refetchRef = useRef(refetch);
  const pollerRef = useRef<PendingPublicationPoller | null>(null);

  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (!listingId) {
      setState({ polling: false, timedOut: false });
      return;
    }
    const poller = createPendingPublicationPoller({
      refetch: () => refetchRef.current(),
      onStop: (stop) => setState({ polling: false, timedOut: stop.kind === 'timed_out' }),
    });
    pollerRef.current = poller;
    setState({ polling: true, timedOut: false });
    poller.start();
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
