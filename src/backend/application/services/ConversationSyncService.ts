import type { ListingStatus } from '../../../shared/types';
import { normalizedTextHash } from '../../domain/conversations/screening';
import type { IConversationRepository } from '../../domain/repositories/interfaces/IConversationRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import { NotFoundError } from '../../domain/shared/DomainError';
import type { ConversationReplyJob, IJobQueue } from '../ports/IJobQueue';

// Threads are read only for adverts that can still carry a conversation.
const SYNCED_LISTING_STATUSES: readonly ListingStatus[] = ['live', 'expired'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The only detail recorded for a failed thread: buyer text must never reach a log.
export const CONVERSATION_THREAD_SYNC_FAILED = 'conversation_thread_sync_failed';

export interface ConversationSyncListing {
  id: string;
  productId: string;
  workspaceId: string;
  marketplaceListingId: string | null;
  status: ListingStatus;
}

export type ConversationSyncStore = Pick<
  IConversationRepository,
  | 'upsertThread'
  | 'upsertMessages'
  | 'supersedePendingDrafts'
  | 'newestUnansweredBuyerMessage'
  | 'startRetentionForListing'
  | 'stopRetentionForListing'
>;

export type ConversationThreadReader = Pick<IMarketplaceAdapter, 'listThreads' | 'listThreadMessages'>;

export interface ConversationSyncDeps {
  // Runs work in one database transaction; the store passed in is bound to it.
  inTransaction<T>(work: (conversations: ConversationSyncStore) => Promise<T>): Promise<T>;
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  replyQueue: IJobQueue<ConversationReplyJob>;
  now: () => Date;
  // An older newest buyer message is stored but gets no automatic run; the seller can regenerate.
  maxMessageAgeDays: number;
  onThreadFailure?: (failure: { listingId: string; code: typeof CONVERSATION_THREAD_SYNC_FAILED }) => void;
}

export class ConversationSyncService {
  constructor(private readonly deps: ConversationSyncDeps) {}

  // Called for every listing of the marketplace: retention starts from stored state alone and
  // stops again for a live listing of an unsold product; threads are read only for live or
  // expired adverts.
  async syncListing(
    listing: ConversationSyncListing,
    adapter: ConversationThreadReader,
  ): Promise<{ newBuyerMessages: number }> {
    const product = await this.deps.products.findByIdForWorkspace(listing.productId, listing.workspaceId);
    if (!product) throw new NotFoundError(`Product not found for synchronized listing: ${listing.productId}`);
    const retentionStartsAt = product.isSold() || listing.status !== 'live' ? this.deps.now() : undefined;
    await this.deps.inTransaction((conversations) =>
      retentionStartsAt
        ? conversations.startRetentionForListing(listing.id, listing.workspaceId, retentionStartsAt)
        : conversations.stopRetentionForListing(listing.id, listing.workspaceId),
    );
    const oldestAutoReply = new Date(this.deps.now().getTime() - this.deps.maxMessageAgeDays * MS_PER_DAY);

    const advertId = listing.marketplaceListingId;
    if (!adapter.listThreads || !adapter.listThreadMessages) return { newBuyerMessages: 0 };
    if (!advertId || !SYNCED_LISTING_STATUSES.includes(listing.status)) return { newBuyerMessages: 0 };
    const readMessages = adapter.listThreadMessages.bind(adapter);

    let newBuyerMessages = 0;
    for (const thread of await adapter.listThreads(advertId)) {
      try {
        const { messages, fetchedCount } = await readMessages(thread.externalThreadId);
        // A partial read could hide a newer message, so the thread waits for a complete read.
        const truncated = thread.totalCount !== null && fetchedCount < thread.totalCount;
        const stored = await this.deps.inTransaction(async (conversations) => {
          const row = await conversations.upsertThread({
            workspaceId: listing.workspaceId,
            listingId: listing.id,
            productId: listing.productId,
            externalThreadId: thread.externalThreadId,
            externalBuyerId: thread.externalBuyerId,
            lastExternalMessageId: messages[messages.length - 1]?.externalMessageId,
            retentionStartsAt,
          });
          const inserted = await conversations.upsertMessages(
            row.id,
            messages.map((m) => ({ ...m, textHash: normalizedTextHash(m.text) })),
          );
          const buyerMessages = inserted.filter((m) => m.direction === 'buyer').length;
          if (buyerMessages > 0) await conversations.supersedePendingDrafts(row.id);
          // Decided from stored state, so a run lost to a failed enqueue is queued again next sync.
          const unanswered = truncated || row.status === 'suspicious'
            ? null
            : await conversations.newestUnansweredBuyerMessage(row.id);
          return { threadId: row.id, buyerMessages, unanswered };
        });
        newBuyerMessages += stored.buyerMessages;
        // The job id deduplicates repeats; the graph skips a message that is no longer the newest.
        if (stored.unanswered && stored.unanswered.sentAt >= oldestAutoReply) {
          await this.deps.replyQueue.enqueue(
            { workspaceId: listing.workspaceId, threadId: stored.threadId, messageId: stored.unanswered.id },
            { jobId: `reply:${stored.unanswered.id}` },
          );
        }
      } catch {
        this.deps.onThreadFailure?.({ listingId: listing.id, code: CONVERSATION_THREAD_SYNC_FAILED });
      }
    }
    return { newBuyerMessages };
  }
}
