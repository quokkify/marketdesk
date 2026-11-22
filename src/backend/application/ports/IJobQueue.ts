// Application-level job-queue port. Use cases enqueue background work through this
// abstraction instead of importing Bull/Redis directly. Group 6 wires the concrete
// BullJobQueue to it. Job payload shapes are declared HERE (application-owned
// contracts) so the application layer never imports infrastructure job types; the
// wiring layer maps these to the structurally-identical infrastructure payloads.

import type { MarketplaceKey, MarketplaceCategoryMetadata } from '../../../shared/types';

export interface JobEnqueueOptions {
  // Optional delay before the job becomes available, in milliseconds.
  delayMs?: number;
  // Optional idempotency / dedupe key.
  jobId?: string;
}

// Generic typed queue. One instance per logical queue/topic.
export interface IJobQueue<TData = unknown> {
  enqueue(data: TData, options?: JobEnqueueOptions): Promise<void>;
  // Atomically accept a bounded group of jobs for one logical operation. Every
  // item must carry a unique jobId so concrete queues can reserve the full set
  // before accepting any new job. Implementations must fail closed on duplicate
  // ids and must not leave a prefix of newly accepted jobs when any item fails.
  enqueueAll(items: Array<{ data: TData; options?: JobEnqueueOptions }>): Promise<void>;
}

// --- Job payload contracts (application-owned) ---

export interface ListingPublishJobInput {
  productName: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  condition: string;
  imageUrls: string[];
}

type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];

export type ListingUpdateJobChanges = RequireAtLeastOne<
  Pick<ListingPublishJobInput, 'price' | 'description' | 'productName'>
>;

interface BasePublishListingJob {
  // Stable id for one logical publish/relist operation. Queue retries reuse it;
  // a later relist of the same listing receives a new id and checkpoint.
  operationId?: string;
  mode?: 'publish' | 'relist' | 'update';
  // Listing generation observed when the logical operation was enqueued.
  listingUpdatedAt?: string;
  marketplaceKey: MarketplaceKey;
  marketplaceId: string;
  listingId: string;
  input: ListingPublishJobInput;
}

export interface PublishOrRelistListingJob extends BasePublishListingJob {
  mode?: 'publish' | 'relist';
  changes?: Partial<Pick<ListingPublishJobInput, 'price' | 'description' | 'productName'>>;
}

export interface UpdateListingJob extends BasePublishListingJob {
  mode: 'update';
  // Product generation observed after the approved change was persisted.
  productUpdatedAt?: string;
  changes: ListingUpdateJobChanges;
}

export type PublishListingJob = PublishOrRelistListingJob | UpdateListingJob;

export interface SyncMarketplaceJob {
  marketplaceKey: MarketplaceKey;
  // Internal marketplace id so the sync handler can persist fetched stats and
  // update the marketplace's lastSyncAt/errorCount (C5).
  marketplaceId: string;
  externalListingIds: string[];
  trigger?: 'manual' | 'scheduled';
  actorId?: string;
}

// One reply-draft graph run for the newest buyer message of a thread. Ids only: message text
// stays in the database and never travels through the queue.
export interface ConversationReplyJob {
  workspaceId: string;
  threadId: string;
  messageId: string;
}

// One sale verdict run. Ids only: the run row holds its scope and state.
export interface SaleVerdictJob {
  workspaceId: string;
  productId: string;
  runId: string;
  // Research even when the schedule says it is not due.
  forceResearch: boolean;
  // The queued research run recorded at request time for a forced research; the price check claims it.
  researchRunId?: string;
}
