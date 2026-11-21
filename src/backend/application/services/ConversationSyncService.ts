import type { ListingStatus } from '../../../shared/types';
import { normalizedTextHash } from '../../domain/conversations/screening';
import type { IConversationRepository } from '../../domain/repositories/interfaces/IConversationRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import { NotFoundError } from '../../domain/shared/DomainError';
import type { ConversationReplyJob, IJobQueue } from '../ports/IJobQueue';

// Threads are read only for adverts that can still carry a conversation.
const SYNCED_LISTING_STATUSES: readonly ListingStatus[] = ['live', 'expired'];

export interface ConversationSyncListing {
  id: string;
  productId: string;
  workspaceId: string;
  marketplaceListingId: string | null;
  status: ListingStatus;
}

export type ConversationSyncStore = Pick<
  IConversationRepository,
  'upsertThread' | 'upsertMessages' | 'supersedePendingDrafts'
>;

export type ConversationThreadReader = Pick<IMarketplaceAdapter, 'listThreads' | 'listThreadMessages'>;

export interface ConversationSyncDeps {
  // Runs work in one database transaction; the store passed in is bound to it.
  inTransaction<T>(work: (conversations: ConversationSyncStore) => Promise<T>): Promise<T>;
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  replyQueue: IJobQueue<ConversationReplyJob>;
  now: () => Date;
}

export class ConversationSyncService {
  constructor(private readonly deps: ConversationSyncDeps) {}

  async syncListing(
    listing: ConversationSyncListing,
    adapter: ConversationThreadReader,
  ): Promise<{ newBuyerMessages: number }> {
    const advertId = listing.marketplaceListingId;
    if (!adapter.listThreads || !adapter.listThreadMessages) return { newBuyerMessages: 0 };
    if (!advertId || !SYNCED_LISTING_STATUSES.includes(listing.status)) return { newBuyerMessages: 0 };

    const product = await this.deps.products.findByIdForWorkspace(listing.productId, listing.workspaceId);
    if (!product) throw new NotFoundError(`Product not found for synchronized listing: ${listing.productId}`);
    const retentionStartsAt = product.isSold() || listing.status !== 'live' ? this.deps.now() : undefined;

    let newBuyerMessages = 0;
    for (const thread of await adapter.listThreads(advertId)) {
      const messages = await adapter.listThreadMessages(thread.externalThreadId);
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
        const buyerMessages = inserted.filter((m) => m.direction === 'buyer');
        if (buyerMessages.length > 0) await conversations.supersedePendingDrafts(row.id);
        return { threadId: row.id, buyerMessages };
      });
      newBuyerMessages += stored.buyerMessages.length;

      // A partial read could hide a newer message, so the thread waits for a complete read.
      const truncated = thread.totalCount !== null && messages.length < thread.totalCount;
      const newest = stored.buyerMessages.reduce<(typeof stored.buyerMessages)[number] | undefined>(
        (latest, m) => (!latest || m.sentAt.getTime() >= latest.sentAt.getTime() ? m : latest),
        undefined,
      );
      if (newest && !truncated) {
        await this.deps.replyQueue.enqueue(
          { workspaceId: listing.workspaceId, threadId: stored.threadId, messageId: newest.id },
          { jobId: `reply:${newest.id}` },
        );
      }
    }
    return { newBuyerMessages };
  }
}
