import type {
  ConversationMessage,
  ConversationThread,
  ReplyDraft,
} from '../../conversations/types';

export type NewConversationThread = Pick<
  ConversationThread,
  'workspaceId' | 'listingId' | 'productId' | 'externalThreadId'
> &
  Partial<
    Pick<
      ConversationThread,
      | 'externalBuyerId'
      | 'status'
      | 'suspiciousReasons'
      | 'lastExternalMessageId'
      | 'retentionStartsAt'
    >
  >;

export type NewConversationMessage = Pick<
  ConversationMessage,
  'externalMessageId' | 'direction' | 'text' | 'textHash' | 'sentAt'
>;

export type NewReplyDraft = Pick<ReplyDraft, 'threadId' | 'answersMessageId'> &
  Partial<Pick<ReplyDraft, 'intent' | 'proposedText' | 'filledPrice' | 'status' | 'failureReason' | 'source'>>;

export type ReplyDraftPatch = Partial<
  Pick<
    ReplyDraft,
    | 'intent'
    | 'proposedText'
    | 'sentText'
    | 'filledPrice'
    | 'status'
    | 'failureReason'
    | 'attemptKey'
    | 'attemptStartedAt'
    | 'externalMessageId'
  >
>;

export interface IConversationRepository {
  // An existing retention start is kept; a later one never moves it.
  upsertThread(thread: NewConversationThread): Promise<ConversationThread>;
  findThreadForWorkspace(threadId: string, workspaceId: string): Promise<ConversationThread | null>;
  listThreadsForProduct(productId: string, workspaceId: string): Promise<ConversationThread[]>;
  // Returns only the messages inserted by this call.
  upsertMessages(threadId: string, messages: NewConversationMessage[]): Promise<ConversationMessage[]>;
  // The thread's newest message when it is from the buyer and no draft answers it.
  newestUnansweredBuyerMessage(threadId: string): Promise<ConversationMessage | null>;
  // Sets retention_starts_at on the listing's threads that have none; returns how many.
  startRetentionForListing(listingId: string, workspaceId: string, at: Date): Promise<number>;
  // Clears retention_starts_at and text_purged_at on the listing's threads that have either, for a
  // listing that is live again; returns how many.
  stopRetentionForListing(listingId: string, workspaceId: string): Promise<number>;
  // Newest first.
  recentMessages(threadId: string, limit: number): Promise<ConversationMessage[]>;
  // Buyer messages only.
  countTextHashInWorkspace(workspaceId: string, hash: string, since: Date): Promise<number>;
  countBuyerMessagesSince(threadId: string, since: Date): Promise<number>;
  insertDraft(draft: NewReplyDraft): Promise<ReplyDraft>;
  findDraft(draftId: string, threadId: string): Promise<ReplyDraft | null>;
  // Newest draft of the thread that a newer buyer message has not superseded.
  latestDraft(threadId: string): Promise<ReplyDraft | null>;
  // Compare-and-set on status, and on the attempt key when one is given: false when the row does
  // not match.
  updateDraft(
    id: string,
    patch: ReplyDraftPatch,
    expectedStatus: ReplyDraft['status'],
    expectedAttemptKey?: string | null,
  ): Promise<boolean>;
  supersedePendingDrafts(threadId: string): Promise<number>;
  // One transaction: supersedes the thread's pending drafts and inserts this one, but only while
  // expectedNewestMessageId is still the thread's newest message. Null when it is not, or when a
  // concurrent run inserted its pending draft first.
  replacePendingDraft(
    threadId: string,
    expectedNewestMessageId: string,
    draft: Omit<NewReplyDraft, 'threadId'>,
  ): Promise<ReplyDraft | null>;
  countReplyRunsToday(workspaceId: string, since: Date): Promise<number>;
  purgeExpiredText(before: Date): Promise<number>;
  awaitingReplyCounts(workspaceId: string): Promise<Record<string, number>>;
}
