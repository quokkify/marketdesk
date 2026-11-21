// Sends an approved reply draft to OLX at most once. OLX has no idempotency key, so the draft moves
// to `sending` with an attempt key before the call, and any doubt about a send is settled by
// re-reading the thread, never by sending again. Message text stays out of logs and activity.

import type { ConversationThread, ReplyDraft } from '../../domain/conversations/types';
import { validateDraft, type DraftRule } from '../../domain/conversations/draftValidation';
import { normalizedTextHash } from '../../domain/conversations/screening';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IConversationRepository } from '../../domain/repositories/interfaces/IConversationRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceAdapter, MarketplaceMessage } from '../../domain/services/MarketplaceAdapter';
import { InvalidStateError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/DomainError';
import type { ConversationReplyJob, IJobQueue } from '../ports/IJobQueue';

// OLX and MarketDesk clocks differ; a matching seller message this much older still counts.
const RECONCILE_CLOCK_SKEW_MS = 5_000;
// Newest stored messages searched for a buyer message newer than the one a draft answers.
const SUPERSEDE_WINDOW = 50;
const UNCLEAR_SEND = 'unclear_send';
const ACTIVITY_ACTION = 'conversation.reply_sent';
// Marketplace error codes (infrastructure MarketplaceError) after which OLX did not take the message.
const REFUSED_CODES = new Set(['AUTHENTICATION', 'NOT_FOUND', 'PROVIDER_REJECTION', 'RATE_LIMIT']);

export type ThreadMessenger = Required<Pick<IMarketplaceAdapter, 'listThreadMessages' | 'sendThreadMessage'>>;

export type ReplyConflictCode =
  | 'superseded'
  | 'already_sending'
  | 'not_pending'
  | 'unclear_send'
  | 'daily_cap'
  | 'nothing_to_answer'
  | 'suspicious';

type Rejected<C extends ReplyConflictCode> = { kind: 'rejected'; code: C };

export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'draft_rule'; rule: DraftRule }
  | Rejected<'superseded' | 'already_sending' | 'not_pending' | 'unclear_send'>;

export type DismissOutcome = { kind: 'dismissed' } | Rejected<'not_pending'>;

export type RegenerateOutcome =
  | { kind: 'queued' }
  | Rejected<'daily_cap' | 'nothing_to_answer' | 'suspicious' | 'already_sending'>;

export type ReplySendStore = Pick<
  IConversationRepository,
  | 'findThreadForWorkspace'
  | 'findDraft'
  | 'latestDraft'
  | 'updateDraft'
  | 'upsertMessages'
  | 'recentMessages'
  | 'countReplyRunsToday'
>;

export interface ReplySendWriteStores {
  conversations: ReplySendStore;
  activityLog: Pick<IActivityLogRepository, 'record'>;
}

export interface ReplySendDeps {
  // Reads; writes go through inTransaction.
  conversations: ReplySendStore;
  // Runs work in one database transaction; the stores passed in are bound to it.
  inTransaction<T>(work: (stores: ReplySendWriteStores) => Promise<T>): Promise<T>;
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByIdForWorkspace'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>;
  adapters: { resolve(marketplace: Marketplace): Promise<Partial<ThreadMessenger>> };
  replyQueue: IJobQueue<ConversationReplyJob>;
  dailyRunCap: number;
  // A `sending` draft whose attempt started less than this ago belongs to a request still waiting
  // for OLX; derived from the OLX request timeout.
  sendingInFlightMs: number;
  idGenerator: () => string;
  now: () => Date;
  // Called with ids and a fixed code only: message text never reaches a log.
  onReplyQueueFailure?: (failure: { threadId: string; code: typeof REPLY_ENQUEUE_FAILED }) => void;
}

export const REPLY_ENQUEUE_FAILED = 'reply_enqueue_failed';

// Beyond the OLX request timeout, room for the CAS writes and the stored-thread reads around it.
const IN_FLIGHT_MARGIN_MS = 60_000;

export function sendingInFlightWindowMs(requestTimeoutMs: number): number {
  return requestTimeoutMs + IN_FLIGHT_MARGIN_MS;
}

// The newest seller message with the attempt's normalised text sent after the attempt began.
function reconciledMessage(
  attempt: { text: string; startedAt: Date },
  messages: MarketplaceMessage[],
): MarketplaceMessage | null {
  const hash = normalizedTextHash(attempt.text);
  const earliest = attempt.startedAt.getTime() - RECONCILE_CLOCK_SKEW_MS;
  let found: MarketplaceMessage | null = null;
  for (const m of messages) {
    if (m.direction !== 'seller' || m.sentAt.getTime() < earliest) continue;
    if (normalizedTextHash(m.text) !== hash) continue;
    if (!found || m.sentAt.getTime() >= found.sentAt.getTime()) found = m;
  }
  return found;
}

export function decideReconcile(
  attempt: { text: string; startedAt: Date },
  sellerMessages: MarketplaceMessage[],
): 'sent' | 'not_sent' {
  return reconciledMessage(attempt, sellerMessages) ? 'sent' : 'not_sent';
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

export class ReplySendService {
  constructor(private readonly deps: ReplySendDeps) {}

  async send(input: {
    workspaceId: string;
    threadId: string;
    draftId: string;
    text: string;
    actorId?: string;
  }): Promise<SendOutcome> {
    const { thread, draft } = await this.load(input.workspaceId, input.threadId, input.draftId);
    const product = await this.deps.products.findByIdForWorkspace(thread.productId, input.workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${thread.productId}`);
    const check = validateDraft(input.text, {
      floor: product.priceFloor().amount,
      currency: product.sellingPrice.currency,
      filledPrice: null,
    });
    if (!check.ok) return { kind: 'draft_rule', rule: check.rule };
    // Resolved before any state change, so a missing OLX connection leaves the draft untouched.
    const messenger = await this.messenger(thread);

    if (draft.status === 'sending') {
      if (this.inFlight(draft)) return { kind: 'rejected', code: 'already_sending' };
      return this.reconcileStale(thread, draft, messenger, input.actorId);
    }
    if (draft.status !== 'pending') {
      return { kind: 'rejected', code: draft.status === 'superseded' ? 'superseded' : 'not_pending' };
    }

    // Every transition out of `sending` below compares this key, so a request that lost the draft
    // to another one can never write over it.
    const attemptKey = this.deps.idGenerator();
    const claimed = await this.write((c) => c.conversations.updateDraft(draft.id, {
      status: 'sending', attemptKey, attemptStartedAt: this.deps.now(), sentText: input.text, failureReason: null,
    }, 'pending'));
    if (!claimed) return this.lostClaim(draft);
    const owned = { ...draft, attemptKey };

    let remote: MarketplaceMessage[];
    try {
      remote = await messenger.listThreadMessages(thread.externalThreadId);
    } catch {
      await this.release(owned);
      throw new ServiceUnavailableError('OLX is not answering right now; try again shortly');
    }
    await this.store(thread.id, remote);
    const newerBuyerMessage = await this.newerBuyerMessage(thread.id, draft.answersMessageId);
    if (newerBuyerMessage) {
      await this.write((c) => c.conversations.updateDraft(draft.id, { status: 'superseded' }, 'sending', attemptKey));
      await this.queueReply(thread, newerBuyerMessage);
      return { kind: 'rejected', code: 'superseded' };
    }

    // Stamped right before the POST, so a slow pre-send read does not shorten the in-flight window.
    const startedAt = this.deps.now();
    const stamped = await this.write((c) => c.conversations.updateDraft(draft.id, {
      attemptStartedAt: startedAt,
    }, 'sending', attemptKey));
    if (!stamped) return { kind: 'rejected', code: 'already_sending' };

    let externalMessageId: string | null;
    try {
      ({ externalMessageId } = await messenger.sendThreadMessage(thread.externalThreadId, input.text));
    } catch (error) {
      return this.afterFailedSend(thread, owned, { text: input.text, startedAt }, messenger, error, input.actorId);
    }
    if (externalMessageId) {
      await this.store(thread.id, [{ externalMessageId, direction: 'seller', text: input.text, sentAt: startedAt }]);
    } else {
      // OLX documents no response body, so the id is learned from the thread; it may stay unknown.
      try {
        const after = await messenger.listThreadMessages(thread.externalThreadId);
        await this.store(thread.id, after);
        externalMessageId = reconciledMessage({ text: input.text, startedAt }, after)?.externalMessageId ?? null;
      } catch {
        externalMessageId = null;
      }
    }
    await this.markSent(thread, owned, 'sending', externalMessageId, input.actorId);
    return { kind: 'sent' };
  }

  async dismiss(input: { workspaceId: string; threadId: string; draftId: string }): Promise<DismissOutcome> {
    const { draft } = await this.load(input.workspaceId, input.threadId, input.draftId);
    const dismissed = await this.write((c) => c.conversations.updateDraft(draft.id, { status: 'dismissed' }, 'pending'));
    return dismissed ? { kind: 'dismissed' } : { kind: 'rejected', code: 'not_pending' };
  }

  async regenerate(input: { workspaceId: string; threadId: string }): Promise<RegenerateOutcome> {
    const { conversations } = this.deps;
    const thread = await conversations.findThreadForWorkspace(input.threadId, input.workspaceId);
    if (!thread) throw new NotFoundError(`Conversation thread not found: ${input.threadId}`);
    if (thread.status === 'suspicious') return { kind: 'rejected', code: 'suspicious' };
    if ((await conversations.latestDraft(thread.id))?.status === 'sending') {
      return { kind: 'rejected', code: 'already_sending' };
    }
    const [newest] = await conversations.recentMessages(thread.id, 1);
    if (newest?.direction !== 'buyer') return { kind: 'rejected', code: 'nothing_to_answer' };
    const current = this.deps.now();
    const dayStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    if (await conversations.countReplyRunsToday(input.workspaceId, dayStart) >= this.deps.dailyRunCap) {
      return { kind: 'rejected', code: 'daily_cap' };
    }
    // A fresh job id: the message's own `reply:<id>` job may already be completed or failed.
    await this.deps.replyQueue.enqueue(
      { workspaceId: thread.workspaceId, threadId: thread.id, messageId: newest.id },
      { jobId: `regen:${this.deps.idGenerator()}` },
    );
    return { kind: 'queued' };
  }

  private async load(workspaceId: string, threadId: string, draftId: string) {
    const thread = await this.deps.conversations.findThreadForWorkspace(threadId, workspaceId);
    if (!thread) throw new NotFoundError(`Conversation thread not found: ${threadId}`);
    const draft = await this.deps.conversations.findDraft(draftId, thread.id);
    if (!draft) throw new NotFoundError(`Reply draft not found: ${draftId}`);
    return { thread, draft };
  }

  private write<T>(work: (stores: ReplySendWriteStores) => Promise<T>): Promise<T> {
    return this.deps.inTransaction(work);
  }

  private inFlight(draft: ReplyDraft): boolean {
    const started = draft.attemptStartedAt?.getTime();
    return started !== undefined && this.deps.now().getTime() - started < this.deps.sendingInFlightMs;
  }

  private async messenger(thread: ConversationThread): Promise<ThreadMessenger> {
    const listing = await this.deps.listings.findByIdForWorkspace(thread.listingId, thread.workspaceId);
    if (!listing) throw new NotFoundError(`Listing not found: ${thread.listingId}`);
    const marketplace = await this.deps.marketplaces.findByIdForWorkspace(listing.marketplaceId, thread.workspaceId);
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${listing.marketplaceId}`);
    const adapter = await this.deps.adapters.resolve(marketplace);
    if (!adapter.listThreadMessages || !adapter.sendThreadMessage) {
      throw new InvalidStateError(`Replies are not supported for marketplace ${marketplace.key}`);
    }
    return adapter as ThreadMessenger;
  }

  // The lost request may or may not have reached OLX, and a message missing from the thread may
  // still arrive, so it is reconciled once and never sent again: a match is `sent`, anything else
  // stays `failed` and the seller checks OLX. Claiming it as `failed` first lets only one request
  // reconcile, and a crash from here on leaves the seller to decide.
  private async reconcileStale(
    thread: ConversationThread,
    draft: ReplyDraft,
    messenger: ThreadMessenger,
    actorId: string | undefined,
  ): Promise<SendOutcome> {
    const claimed = await this.write((c) => c.conversations.updateDraft(draft.id, {
      status: 'failed', failureReason: UNCLEAR_SEND,
    }, 'sending', draft.attemptKey));
    if (!claimed) return this.lostClaim(draft);
    if (!draft.sentText || !draft.attemptStartedAt) return { kind: 'rejected', code: 'unclear_send' };
    let remote: MarketplaceMessage[];
    try {
      remote = await messenger.listThreadMessages(thread.externalThreadId);
    } catch {
      return { kind: 'rejected', code: 'unclear_send' };
    }
    await this.store(thread.id, remote);
    const found = reconciledMessage({ text: draft.sentText, startedAt: draft.attemptStartedAt }, remote);
    if (!found) return { kind: 'rejected', code: 'unclear_send' };
    await this.markSent(thread, draft, 'failed', found.externalMessageId, actorId);
    return { kind: 'sent' };
  }

  // OLX refused the message: nothing was sent and the seller may try again. Any other failure is
  // settled by re-reading the thread; when that cannot prove a send, the seller decides.
  private async afterFailedSend(
    thread: ConversationThread,
    draft: ReplyDraft,
    attempt: { text: string; startedAt: Date },
    messenger: ThreadMessenger,
    error: unknown,
    actorId: string | undefined,
  ): Promise<SendOutcome> {
    if (REFUSED_CODES.has(String(errorCode(error)))) {
      await this.release(draft);
      throw this.refusal(error);
    }
    let found: MarketplaceMessage | null = null;
    try {
      const remote = await messenger.listThreadMessages(thread.externalThreadId);
      await this.store(thread.id, remote);
      found = reconciledMessage(attempt, remote);
    } catch {
      found = null;
    }
    if (found) {
      await this.markSent(thread, draft, 'sending', found.externalMessageId, actorId);
      return { kind: 'sent' };
    }
    await this.write((c) => c.conversations.updateDraft(draft.id, {
      status: 'failed', failureReason: UNCLEAR_SEND,
    }, 'sending', draft.attemptKey));
    return { kind: 'rejected', code: 'unclear_send' };
  }

  private refusal(error: unknown): Error {
    switch (errorCode(error)) {
      case 'AUTHENTICATION':
        return new InvalidStateError('OLX refused the stored authorization; reconnect OLX and try again');
      case 'NOT_FOUND':
        return new InvalidStateError('The conversation no longer exists on OLX');
      case 'RATE_LIMIT':
        return new ServiceUnavailableError('OLX is limiting requests; try again shortly');
      default:
        return new InvalidStateError('OLX refused the message');
    }
  }

  private async release(draft: ReplyDraft): Promise<void> {
    await this.write((c) => c.conversations.updateDraft(draft.id, {
      status: 'pending', attemptKey: null, attemptStartedAt: null, sentText: null,
    }, 'sending', draft.attemptKey));
  }

  private async lostClaim(draft: ReplyDraft): Promise<Rejected<'superseded' | 'already_sending' | 'not_pending'>> {
    const current = await this.deps.conversations.findDraft(draft.id, draft.threadId);
    if (current?.status === 'sending') return { kind: 'rejected', code: 'already_sending' };
    return { kind: 'rejected', code: current?.status === 'superseded' ? 'superseded' : 'not_pending' };
  }

  private async store(threadId: string, messages: MarketplaceMessage[]): Promise<void> {
    await this.write((c) => c.conversations.upsertMessages(
      threadId,
      messages.map((m) => ({ ...m, textHash: normalizedTextHash(m.text) })),
    ));
  }

  private async newerBuyerMessage(threadId: string, answersMessageId: string) {
    const recent = await this.deps.conversations.recentMessages(threadId, SUPERSEDE_WINDOW);
    const newestBuyer = recent.find((m) => m.direction === 'buyer');
    return newestBuyer && newestBuyer.id !== answersMessageId ? newestBuyer : null;
  }

  // The next sync queues the run from stored state anyway, so a failed enqueue only delays the draft.
  private async queueReply(thread: ConversationThread, message: { id: string }): Promise<void> {
    try {
      await this.deps.replyQueue.enqueue(
        { workspaceId: thread.workspaceId, threadId: thread.id, messageId: message.id },
        { jobId: `reply:${message.id}` },
      );
    } catch {
      this.deps.onReplyQueueFailure?.({ threadId: thread.id, code: REPLY_ENQUEUE_FAILED });
    }
  }

  private async markSent(
    thread: ConversationThread,
    draft: ReplyDraft,
    from: ReplyDraft['status'],
    externalMessageId: string | null,
    actorId: string | undefined,
  ): Promise<void> {
    await this.write(async ({ conversations, activityLog }) => {
      const sent = await conversations.updateDraft(draft.id, {
        status: 'sent', externalMessageId, failureReason: null,
      }, from, draft.attemptKey);
      if (!sent) return;
      await activityLog.record({
        id: this.deps.idGenerator(),
        workspaceId: thread.workspaceId,
        entityType: 'conversation_thread',
        entityId: thread.id,
        actorType: 'user',
        actorId,
        action: ACTIVITY_ACTION,
        metadata: { threadId: thread.id, draftId: draft.id },
        createdAt: this.deps.now(),
      });
    });
  }
}
