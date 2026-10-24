// Shared test support for the publish pipeline: a queue that runs the real
// PublishListingHandler synchronously and an in-memory publish attempt store, so
// HTTP tests finalize a publish in-process without Bull, Redis or Postgres.

import type { IJobQueue, PublishListingJob } from '../../application/ports/IJobQueue';
import type {
  PublishAttemptCheckpoint,
  PublishAttemptStore,
  PublishListingHandler,
} from '../jobQueue/JobHandlers/PublishListingHandler';

// A synchronous publish queue: enqueue immediately runs the real PublishListingHandler,
// so the listing is finalized before the HTTP response returns.
export class SyncPublishQueue implements IJobQueue<PublishListingJob> {
  constructor(private readonly handler: PublishListingHandler) {}
  async enqueue(data: PublishListingJob): Promise<void> {
    await this.handler.handle(data);
  }
  async enqueueAll(
    items: Array<{ data: PublishListingJob; options?: { jobId?: string } }>
  ): Promise<void> {
    const jobIds = items
      .map((item) => item.options?.jobId)
      .filter((jobId): jobId is string => !!jobId);
    if (jobIds.length !== items.length || new Set(jobIds).size !== jobIds.length) {
      throw new Error('SyncPublishQueue bulk enqueue requires unique jobIds');
    }
    for (const item of items) await this.enqueue(item.data);
  }
}

// In-memory publish attempt store keyed by operation id.
export function inMemoryPublishAttempts(): PublishAttemptStore {
  const checkpoints = new Map<string, PublishAttemptCheckpoint>();
  return {
    find: async (operationId) => checkpoints.get(operationId) ?? null,
    begin: async (operationId, listingId, marketplaceKey, listingUpdatedAt) => {
      const checkpoint: PublishAttemptCheckpoint = {
        operationId,
        listingId,
        marketplaceKey,
        listingUpdatedAt,
        status: 'publishing',
        externalListingId: null,
        externalUrl: null,
        publishedAt: null,
        remoteStatus: null,
        remoteImageUrls: [],
      };
      checkpoints.set(operationId, checkpoint);
      return { created: true, checkpoint };
    },
    markPublished: async (operationId, result) => {
      const checkpoint = checkpoints.get(operationId)!;
      checkpoints.set(operationId, {
        ...checkpoint,
        status: 'published',
        externalListingId: result.externalListingId,
        externalUrl: result.externalUrl ?? null,
        publishedAt: result.publishedAt,
        remoteStatus: result.remoteStatus ?? null,
        remoteImageUrls: result.remoteImageUrls ?? [],
      });
    },
    markFinalized: async (operationId) => {
      const checkpoint = checkpoints.get(operationId)!;
      checkpoints.set(operationId, { ...checkpoint, status: 'finalized' });
    },
    markAbandoned: async (operationId) => {
      const checkpoint = checkpoints.get(operationId)!;
      checkpoints.set(operationId, { ...checkpoint, status: 'abandoned' });
    },
  };
}
