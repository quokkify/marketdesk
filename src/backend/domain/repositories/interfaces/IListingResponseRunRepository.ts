import type { ListingResponseRun } from '../../../../shared/types';

export interface NewListingResponseRun {
  id: string;
  workspaceId: string;
  productId: string;
  listingId: string;
  graphVersion: string;
  fingerprint: string;
  queuedAt: string;
}

export type CompletedListingResponseFields = Pick<
  ListingResponseRun,
  'stage' | 'signal' | 'probes' | 'findings'
> & { completedAt: string };

// Run state and result of the listing response graph. A listing has at most one queued or running run
// (a partial unique index).
export interface IListingResponseRunRepository {
  // Null when the listing already has a queued or running run.
  insertQueued(run: NewListingResponseRun): Promise<ListingResponseRun | null>;
  findActive(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
  // queued → running for this run only; null when the run is no longer queued.
  claim(runId: string, startedAt: string, leaseUntil: string): Promise<ListingResponseRun | null>;
  // queued or running → completed; false when the run already left those states.
  complete(runId: string, fields: CompletedListingResponseFields): Promise<boolean>;
  // queued or running → failed; false when the run already left those states.
  fail(runId: string, completedAt: string, errorCode: string): Promise<boolean>;
  // Fails the listing's running run whose lease ended, or queued run queued before queuedBefore (its
  // job was lost); true when one was failed.
  failExpired(workspaceId: string, listingId: string, now: string, queuedBefore: string, errorCode: string): Promise<boolean>;
  findById(workspaceId: string, runId: string): Promise<ListingResponseRun | null>;
  findLatestCompleted(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
  // The newest run by queued_at, whatever its status.
  findNewest(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
  findLatestCompletedForProducts(
    workspaceId: string,
    productIds: string[],
  ): Promise<Map<string, ListingResponseRun>>;
}
