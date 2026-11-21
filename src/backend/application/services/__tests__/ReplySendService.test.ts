import { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { ConversationMessage, ConversationThread, ReplyDraft } from '../../../domain/conversations/types';
import type {
  NewConversationMessage,
  ReplyDraftPatch,
} from '../../../domain/repositories/interfaces/IConversationRepository';
import type { ActivityLogEntry } from '../../../domain/repositories/interfaces/IActivityLogRepository';
import type { MarketplaceMessage } from '../../../domain/services/MarketplaceAdapter';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { InMemoryProductRepository, money, unwrap } from '../../../domain/testkit/support';
import type { ConversationReplyJob, IJobQueue, JobEnqueueOptions } from '../../ports/IJobQueue';
import { ReplySendService, type ThreadMessenger } from '../ReplySendService';

const NOW = new Date('2026-11-21T12:00:00Z');
const WORKSPACE = 'w1';
const REPLY = 'Yes, it is still available.';

class FakeConversations {
  readonly threads = new Map<string, ConversationThread>();
  readonly messages: ConversationMessage[] = [];
  readonly drafts = new Map<string, ReplyDraft>();
  runsToday = 0;

  async findThreadForWorkspace(threadId: string, workspaceId: string): Promise<ConversationThread | null> {
    const thread = this.threads.get(threadId);
    return thread?.workspaceId === workspaceId ? thread : null;
  }

  async findDraft(draftId: string, threadId: string): Promise<ReplyDraft | null> {
    const draft = this.drafts.get(draftId);
    return draft?.threadId === threadId ? draft : null;
  }

  async latestDraft(threadId: string): Promise<ReplyDraft | null> {
    return [...this.drafts.values()].filter((d) => d.threadId === threadId && d.status !== 'superseded').pop() ?? null;
  }

  async updateDraft(id: string, patch: ReplyDraftPatch, expectedStatus: ReplyDraft['status']): Promise<boolean> {
    const draft = this.drafts.get(id);
    if (draft?.status !== expectedStatus) return false;
    this.drafts.set(id, { ...draft, ...patch });
    return true;
  }

  async upsertMessages(threadId: string, messages: NewConversationMessage[]): Promise<ConversationMessage[]> {
    const inserted: ConversationMessage[] = [];
    for (const m of messages) {
      if (this.messages.some((s) => s.threadId === threadId && s.externalMessageId === m.externalMessageId)) continue;
      const row = { ...m, id: `m-${m.externalMessageId}`, threadId };
      this.messages.push(row);
      inserted.push(row);
    }
    return inserted;
  }

  async recentMessages(threadId: string, limit: number): Promise<ConversationMessage[]> {
    return this.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }

  async countReplyRunsToday(): Promise<number> {
    return this.runsToday;
  }

  draft(id = 'd1'): ReplyDraft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`no draft ${id}`);
    return draft;
  }
}

class FakeMessenger implements ThreadMessenger {
  readonly remote: MarketplaceMessage[] = [];
  readonly sent: string[] = [];
  failReads = 0;
  sendError: Error | null = null;
  returnId = true;

  async listThreadMessages(): Promise<MarketplaceMessage[]> {
    if (this.failReads > 0) {
      this.failReads -= 1;
      throw new Error('read failed');
    }
    return [...this.remote];
  }

  async sendThreadMessage(_thread: string, text: string): Promise<{ externalMessageId: string | null }> {
    if (this.sendError) throw this.sendError;
    this.sent.push(text);
    const id = `olx-${this.sent.length}`;
    this.remote.push({ externalMessageId: id, direction: 'seller', text, sentAt: NOW });
    return { externalMessageId: this.returnId ? id : null };
  }
}

class FakeQueue implements IJobQueue<ConversationReplyJob> {
  readonly jobs: { data: ConversationReplyJob; options?: JobEnqueueOptions }[] = [];
  async enqueue(data: ConversationReplyJob, options?: JobEnqueueOptions): Promise<void> {
    this.jobs.push({ data, options });
  }
  async enqueueAll(): Promise<void> {}
}

async function setup(options: { draftStatus?: ReplyDraft['status'] } = {}) {
  const conversations = new FakeConversations();
  const products = new InMemoryProductRepository();
  await products.save(unwrap(Product.create({
    id: 'p1', workspaceId: WORKSPACE, sku: 'SKU-1', name: 'Camera',
    description: 'Camera with lens and accessories, works well.', costPrice: money(40),
    sellingPrice: money(100), minAcceptablePrice: money(70), condition: 'good', category: 'electronics',
    status: 'active',
  })));
  conversations.threads.set('t1', {
    id: 't1', workspaceId: WORKSPACE, listingId: 'l1', productId: 'p1', externalThreadId: 'ext-1',
    externalBuyerId: null, status: 'open', suspiciousReasons: [], lastExternalMessageId: null,
    retentionStartsAt: null, textPurgedAt: null, createdAt: NOW, updatedAt: NOW,
  });
  const messenger = new FakeMessenger();
  const question: MarketplaceMessage = {
    externalMessageId: 'b1', direction: 'buyer', text: 'Is it available?', sentAt: new Date(NOW.getTime() - 60_000),
  };
  messenger.remote.push(question);
  await conversations.upsertMessages('t1', [{ ...question, textHash: null }]);
  conversations.drafts.set('d1', {
    id: 'd1', threadId: 't1', answersMessageId: 'm-b1', intent: 'availability', proposedText: REPLY, sentText: null,
    filledPrice: null, status: options.draftStatus ?? 'pending', failureReason: null, source: 'offline',
    attemptKey: null, attemptStartedAt: null, externalMessageId: null, createdAt: NOW, updatedAt: NOW,
  });
  const activity: ActivityLogEntry[] = [];
  const queue = new FakeQueue();
  let clock = NOW;
  let ids = 0;
  const service = new ReplySendService({
    conversations,
    inTransaction: (work) => work({ conversations, activityLog: { record: async (e) => { activity.push(e); } } }),
    products,
    listings: { findByIdForWorkspace: async (id) => (id === 'l1' ? ({ marketplaceId: 'mk1' } as Listing) : null) },
    marketplaces: {
      findByIdForWorkspace: async (id) => (id === 'mk1' ? ({ id: 'mk1', key: 'olx' } as Marketplace) : null),
    },
    adapters: { resolve: async () => messenger },
    replyQueue: queue,
    dailyRunCap: 3,
    idGenerator: () => `id-${++ids}`,
    now: () => clock,
  });
  const send = (text = REPLY, draftId = 'd1') =>
    service.send({ workspaceId: WORKSPACE, threadId: 't1', draftId, text, actorId: 'u1' });
  return {
    conversations, messenger, activity, queue, service, send,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
  };
}

describe('ReplySendService.send', () => {
  it('sends the edited text once, stores the OLX message and logs ids only', async () => {
    const { conversations, messenger, activity, send } = await setup();
    expect(await send('Yes, still here.')).toEqual({ kind: 'sent' });
    expect(messenger.sent).toEqual(['Yes, still here.']);
    expect(conversations.draft()).toMatchObject({
      status: 'sent', sentText: 'Yes, still here.', externalMessageId: 'olx-1', attemptKey: 'id-1',
      attemptStartedAt: NOW,
    });
    expect(conversations.messages.map((m) => [m.direction, m.externalMessageId])).toEqual([
      ['buyer', 'b1'], ['seller', 'olx-1'],
    ]);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: 'conversation.reply_sent', entityId: 't1', workspaceId: WORKSPACE });
    expect(JSON.stringify(activity)).not.toContain('still here');
    expect(activity[0].metadata).toEqual({ threadId: 't1', draftId: 'd1' });
  });

  it('rejects edited text that breaks a draft rule without touching OLX', async () => {
    const { conversations, messenger, send } = await setup();
    expect(await send('Ok, 50 zł')).toEqual({ kind: 'draft_rule', rule: 'below_floor' });
    expect(await send('See https://example.com/x')).toEqual({ kind: 'draft_rule', rule: 'link' });
    expect(messenger.sent).toEqual([]);
    expect(conversations.draft().status).toBe('pending');
  });

  it('marks the draft superseded and does not send when the re-read finds a newer buyer message', async () => {
    const { conversations, messenger, queue, send } = await setup();
    messenger.remote.push({ externalMessageId: 'b2', direction: 'buyer', text: 'Hello?', sentAt: NOW });
    expect(await send()).toEqual({ kind: 'rejected', code: 'superseded' });
    expect(messenger.sent).toEqual([]);
    expect(conversations.draft().status).toBe('superseded');
    expect(queue.jobs).toEqual([
      { data: { workspaceId: WORKSPACE, threadId: 't1', messageId: 'm-b2' }, options: { jobId: 'reply:m-b2' } },
    ]);
  });

  it('finds the sent message by re-reading the thread when OLX returns no id', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.returnId = false;
    expect(await send()).toEqual({ kind: 'sent' });
    expect(conversations.draft()).toMatchObject({ status: 'sent', externalMessageId: 'olx-1' });
  });

  it('stays sent with an unknown id when the post-send re-read fails', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.returnId = false;
    const read = messenger.listThreadMessages.bind(messenger);
    let reads = 0;
    messenger.listThreadMessages = async () => {
      reads += 1;
      if (reads > 1) throw new Error('read failed');
      return read();
    };
    expect(await send()).toEqual({ kind: 'sent' });
    expect(conversations.draft()).toMatchObject({ status: 'sent', externalMessageId: null });
  });

  it('answers already_sending to a second request while the first is in flight, and sends once', async () => {
    const { conversations, messenger, send } = await setup();
    const results = await Promise.all([send(), send()]);
    expect(results).toEqual(expect.arrayContaining([
      { kind: 'sent' }, { kind: 'rejected', code: 'already_sending' },
    ]));
    expect(messenger.sent).toHaveLength(1);
    expect(conversations.draft().status).toBe('sent');
  });

  it('returns the draft to pending when the pre-send re-read fails', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.failReads = 1;
    await expect(send()).rejects.toThrow(/OLX/);
    expect(messenger.sent).toEqual([]);
    expect(conversations.draft()).toMatchObject({ status: 'pending', attemptKey: null, sentText: null });
  });

  it('returns the draft to pending when OLX refuses the send', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.sendError = Object.assign(new Error('olx:sendThreadMessage: HTTP 400'), { code: 'PROVIDER_REJECTION' });
    await expect(send()).rejects.toThrow(/refused/);
    expect(conversations.draft().status).toBe('pending');
  });

  it('marks an ambiguous send failure unclear unless the re-read finds the message', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.sendError = Object.assign(new Error('timed out'), { code: 'TRANSIENT' });
    expect(await send()).toEqual({ kind: 'rejected', code: 'unclear_send' });
    expect(conversations.draft()).toMatchObject({ status: 'failed', failureReason: 'unclear_send' });
    expect(messenger.sent).toEqual([]);
  });

  it('records an ambiguous send as sent when the re-read finds it', async () => {
    const { conversations, messenger, send } = await setup();
    messenger.sendError = Object.assign(new Error('timed out'), { code: 'TRANSIENT' });
    const original = messenger.sendThreadMessage.bind(messenger);
    messenger.sendThreadMessage = async (thread, text) => {
      messenger.sendError = null;
      await original(thread, text);
      throw Object.assign(new Error('timed out'), { code: 'TRANSIENT' });
    };
    expect(await send()).toEqual({ kind: 'sent' });
    expect(conversations.draft()).toMatchObject({ status: 'sent', externalMessageId: 'olx-1' });
    expect(messenger.sent).toHaveLength(1);
  });

  describe('a draft found in sending after its request was lost', () => {
    async function stale() {
      const ctx = await setup({ draftStatus: 'sending' });
      await ctx.conversations.updateDraft('d1', {
        attemptKey: 'old', attemptStartedAt: new Date(NOW.getTime() - 10 * 60_000), sentText: REPLY,
      }, 'sending');
      return ctx;
    }

    it('is recorded as sent without a second send when OLX already has the message', async () => {
      const ctx = await stale();
      ctx.messenger.remote.push({
        externalMessageId: 'olx-9', direction: 'seller', text: REPLY, sentAt: new Date(NOW.getTime() - 9 * 60_000),
      });
      expect(await ctx.send()).toEqual({ kind: 'sent' });
      expect(ctx.messenger.sent).toEqual([]);
      expect(ctx.conversations.draft()).toMatchObject({ status: 'sent', externalMessageId: 'olx-9', failureReason: null });
      expect(ctx.activity).toHaveLength(1);
    });

    it('is sent when OLX does not have the message', async () => {
      const ctx = await stale();
      expect(await ctx.send()).toEqual({ kind: 'sent' });
      expect(ctx.messenger.sent).toEqual([REPLY]);
      expect(ctx.conversations.draft()).toMatchObject({ status: 'sent', failureReason: null });
    });

    it('fails as unclear_send when the thread cannot be read', async () => {
      const ctx = await stale();
      ctx.messenger.failReads = 1;
      expect(await ctx.send()).toEqual({ kind: 'rejected', code: 'unclear_send' });
      expect(ctx.messenger.sent).toEqual([]);
      expect(ctx.conversations.draft()).toMatchObject({ status: 'failed', failureReason: 'unclear_send' });
    });
  });

  it('answers not_pending for a dismissed draft and 404 for a foreign thread or unknown draft', async () => {
    const { conversations, service, send } = await setup({ draftStatus: 'dismissed' });
    expect(await send()).toEqual({ kind: 'rejected', code: 'not_pending' });
    await expect(service.send({ workspaceId: 'w2', threadId: 't1', draftId: 'd1', text: REPLY, actorId: 'u1' }))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(send(REPLY, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(conversations.draft().status).toBe('dismissed');
  });
});

describe('ReplySendService.dismiss', () => {
  it('dismisses a pending draft once', async () => {
    const { conversations, service } = await setup();
    const input = { workspaceId: WORKSPACE, threadId: 't1', draftId: 'd1' };
    expect(await service.dismiss(input)).toEqual({ kind: 'dismissed' });
    expect(conversations.draft().status).toBe('dismissed');
    expect(await service.dismiss(input)).toEqual({ kind: 'rejected', code: 'not_pending' });
  });
});

describe('ReplySendService.regenerate', () => {
  it('queues a fresh reply run for the newest buyer message', async () => {
    const { queue, service } = await setup();
    expect(await service.regenerate({ workspaceId: WORKSPACE, threadId: 't1' })).toEqual({ kind: 'queued' });
    expect(queue.jobs).toEqual([
      { data: { workspaceId: WORKSPACE, threadId: 't1', messageId: 'm-b1' }, options: { jobId: 'regen:id-1' } },
    ]);
  });

  it('refuses when the daily cap is reached', async () => {
    const { conversations, queue, service } = await setup();
    conversations.runsToday = 3;
    expect(await service.regenerate({ workspaceId: WORKSPACE, threadId: 't1' }))
      .toEqual({ kind: 'rejected', code: 'daily_cap' });
    expect(queue.jobs).toEqual([]);
  });

  it('refuses when the newest message is the seller reply', async () => {
    const { conversations, queue, service } = await setup();
    await conversations.upsertMessages('t1', [{
      externalMessageId: 's1', direction: 'seller', text: 'ok', textHash: null, sentAt: NOW,
    }]);
    expect(await service.regenerate({ workspaceId: WORKSPACE, threadId: 't1' }))
      .toEqual({ kind: 'rejected', code: 'nothing_to_answer' });
    expect(queue.jobs).toEqual([]);
  });
});
