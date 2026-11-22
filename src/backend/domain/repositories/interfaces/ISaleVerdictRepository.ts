import type {
  SaleVerdict,
  VerdictCheck,
  VerdictCheckName,
  VerdictOverall,
} from '../../../../shared/types';

export interface NewVerdictRun {
  id: string;
  workspaceId: string;
  productId: string;
  graphVersion: string;
  scope: VerdictCheckName[];
  queuedAt: string;
}

export interface CompletedVerdictFields {
  overall: VerdictOverall;
  checks: Partial<Record<VerdictCheckName, VerdictCheck>>;
  completedAt: string;
}

// Run state and result of the sale verdict graph. A product has at most one queued or running run
// (a partial unique index).
export interface ISaleVerdictRepository {
  // Null when the product already has a queued or running run.
  insertQueued(run: NewVerdictRun): Promise<SaleVerdict | null>;
  findActive(workspaceId: string, productId: string): Promise<SaleVerdict | null>;
  // queued → running for this run only; null when the run is no longer queued.
  claim(runId: string, startedAt: string, leaseUntil: string): Promise<SaleVerdict | null>;
  setListing(runId: string, listingId: string | null): Promise<void>;
  // queued or running → completed; false when the run already left those states.
  complete(runId: string, fields: CompletedVerdictFields): Promise<boolean>;
  // queued or running → failed; false when the run already left those states.
  fail(runId: string, completedAt: string, errorCode: string): Promise<boolean>;
  // Fails the product's running run whose lease ended, or queued run queued before queuedBefore (its
  // job was lost); true when one was failed.
  failExpired(workspaceId: string, productId: string, now: string, queuedBefore: string, errorCode: string): Promise<boolean>;
  findById(workspaceId: string, runId: string): Promise<SaleVerdict | null>;
  findLatestCompleted(workspaceId: string, productId: string): Promise<SaleVerdict | null>;
  findLatestCompletedForProducts(
    workspaceId: string,
    productIds: string[],
  ): Promise<Map<string, SaleVerdict>>;
  // The ids among productIds whose newest run (by queued_at) failed, in one query.
  lastRunFailedForProducts(workspaceId: string, productIds: string[]): Promise<Set<string>>;
  // True when the newest run of the product (by queued_at) failed.
  lastRunFailed(workspaceId: string, productId: string): Promise<boolean>;
}
