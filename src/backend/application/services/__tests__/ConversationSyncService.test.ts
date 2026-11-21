import { Product } from '../../../domain/entities/Product';
import type { ConversationMessage, ConversationThread } from '../../../domain/conversations/types';
import type {
  NewConversationMessage,
  NewConversationThread,
} from '../../../domain/repositories/interfaces/IConversationRepository';
import type { MarketplaceMessage, MarketplaceThread } from '../../../domain/services/MarketplaceAdapter';
import type { ProductStatus } from '../../../../shared/types';
import type { ConversationReplyJob, IJobQueue, JobEnqueueOptions } from '../../ports/IJobQueue';
import { normalizedTextHash } from '../../../domain/conversations/screening';
import { InMemoryProductRepository, money, unwrap } from '../../../domain/testkit/support';
import {
  CONVERSATION_THREAD_SYNC_FAILED,
  ConversationSyncService,
  type ConversationSyncListing,
} from '../ConversationSyncService';

const NOW = new Date('2026-11-21T12:00:00Z');
const WORKSPACE = 'w1';

class FakeConversations {
  readonly threads = new Map<string, ConversationThread>();
  readonly messages: ConversationMessage[] = [];
  readonly answered = new Set<string>();
  readonly superseded: string[] = [];
  readonly transactions: string[] = [];

  async upsertThread(thread: NewConversationThread): Promise<ConversationThread> {
    const existing = [...this.threads.values()].find((t) => t.externalThreadId === thread.externalThreadId);
    const base: ConversationThread = existing ?? {
      id: `t${this.threads.size + 1}`, workspaceId: thread.workspaceId, listingId: thread.listingId,
      productId: thread.productId, externalThreadId: thread.externalThreadId, externalBuyerId: null,
      status: 'open', suspiciousReasons: [], lastExternalMessageId: null, retentionStartsAt: null,
      textPurgedAt: null, createdAt: NOW, updatedAt: NOW,
    };
    // Mirrors the repository: an existing retention start is kept.
    const next: ConversationThread = {
      ...base,
      externalBuyerId: thread.externalBuyerId ?? base.externalBuyerId,
      lastExternalMessageId: thread.lastExternalMessageId ?? base.lastExternalMessageId,
      retentionStartsAt: base.retentionStartsAt ?? thread.retentionStartsAt ?? null,
    };
    this.threads.set(next.id, next);
    return next;
  }

  async upsertMessages(threadId: string, messages: NewConversationMessage[]): Promise<ConversationMessage[]> {
    const inserted: ConversationMessage[] = [];
    for (const m of messages) {
      if (this.messages.some((s) => s.threadId === threadId && s.externalMessageId === m.externalMessageId)) continue;
      const row = { ...m, id: `m${this.messages.length + 1}`, threadId };
      this.messages.push(row);
      inserted.push(row);
    }
    return inserted;
  }

  async supersedePendingDrafts(threadId: string): Promise<number> {
    this.superseded.push(threadId);
    return 1;
  }

  async newestUnansweredBuyerMessage(threadId: string): Promise<ConversationMessage | null> {
    const newest = this.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    return newest?.direction === 'buyer' && !this.answered.has(newest.id) ? newest : null;
  }

  async startRetentionForListing(listingId: string, workspaceId: string, at: Date): Promise<number> {
    let started = 0;
    for (const t of this.threads.values()) {
      if (t.listingId !== listingId || t.workspaceId !== workspaceId || t.retentionStartsAt) continue;
      this.threads.set(t.id, { ...t, retentionStartsAt: at });
      started += 1;
    }
    return started;
  }

  async stopRetentionForListing(listingId: string, workspaceId: string): Promise<number> {
    let stopped = 0;
    for (const t of this.threads.values()) {
      if (t.listingId !== listingId || t.workspaceId !== workspaceId) continue;
      if (!t.retentionStartsAt && !t.textPurgedAt) continue;
      this.threads.set(t.id, { ...t, retentionStartsAt: null, textPurgedAt: null });
      stopped += 1;
    }
    return stopped;
  }

  byExternalId(id: string): ConversationMessage {
    const message = this.messages.find((m) => m.externalMessageId === id);
    if (!message) throw new Error(`no message ${id}`);
    return message;
  }
}

class RecordingQueue implements IJobQueue<ConversationReplyJob> {
  readonly jobs: Array<{ data: ConversationReplyJob; options?: JobEnqueueOptions }> = [];
  failNext = false;
  async enqueue(data: ConversationReplyJob, options?: JobEnqueueOptions): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis down');
    }
    this.jobs.push({ data, options });
  }
  async enqueueAll(): Promise<void> {
    throw new Error('not used');
  }
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 10, minute));
const buyer = (id: string, minute: number, text = `buyer ${id}`): MarketplaceMessage =>
  ({ externalMessageId: id, direction: 'buyer', text, sentAt: at(minute) });
const seller = (id: string, minute: number): MarketplaceMessage =>
  ({ externalMessageId: id, direction: 'seller', text: `seller ${id}`, sentAt: at(minute) });

function adapterWith(
  threads: MarketplaceThread[],
  messages: Record<string, MarketplaceMessage[]>,
  skipped: Record<string, number> = {},
) {
  return {
    listThreads: jest.fn(async () => threads),
    listThreadMessages: jest.fn(async (id: string) => {
      const found = messages[id];
      if (!found) throw new Error(`thread ${id} unreadable`);
      return { messages: found, fetchedCount: found.length + (skipped[id] ?? 0) };
    }),
  };
}

const thread = (id: string, totalCount: number | null = null): MarketplaceThread =>
  ({ externalThreadId: id, externalBuyerId: `buyer-${id}`, totalCount });

async function setup(options: { productStatus?: ProductStatus } = {}) {
  const conversations = new FakeConversations();
  const products = new InMemoryProductRepository();
  await products.save(unwrap(Product.create({
    id: 'p1', workspaceId: WORKSPACE, sku: 'SKU-1', name: 'Camera',
    description: 'Camera with lens and accessories, works well.', costPrice: money(40),
    sellingPrice: money(100), condition: 'good', category: 'electronics',
    status: options.productStatus ?? 'active',
  })));
  const queue = new RecordingQueue();
  const failures: unknown[] = [];
  const service = new ConversationSyncService({
    inTransaction: async (work) => {
      conversations.transactions.push('begin');
      const result = await work(conversations);
      conversations.transactions.push('commit');
      return result;
    },
    products,
    replyQueue: queue,
    now: () => NOW,
    maxMessageAgeDays: 14,
    onThreadFailure: (failure) => failures.push(failure),
  });
  return { conversations, queue, service, failures };
}

const listing = (overrides: Partial<ConversationSyncListing> = {}): ConversationSyncListing => ({
  id: 'l1', productId: 'p1', workspaceId: WORKSPACE, marketplaceListingId: 'adv-1', status: 'live', ...overrides,
});

describe('ConversationSyncService', () => {
  it('stores threads and messages with a text hash and queues one run for the newest buyer message', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a'), thread('b')], {
      a: [buyer('a1', 1), seller('a2', 2), buyer('a3', 3, 'Is it  AVAILABLE?')],
      b: [buyer('b1', 1)],
    });

    const result = await service.syncListing(listing(), adapter);

    expect(result).toEqual({ newBuyerMessages: 3 });
    expect(adapter.listThreads).toHaveBeenCalledWith('adv-1');
    const stored = [...conversations.threads.values()];
    expect(stored.map((t) => [t.externalThreadId, t.listingId, t.productId, t.externalBuyerId, t.lastExternalMessageId]))
      .toEqual([['a', 'l1', 'p1', 'buyer-a', 'a3'], ['b', 'l1', 'p1', 'buyer-b', 'b1']]);
    expect(conversations.byExternalId('a3').textHash).toBe(normalizedTextHash('Is it  AVAILABLE?'));
    const newestA = conversations.byExternalId('a3');
    const newestB = conversations.byExternalId('b1');
    expect(queue.jobs).toEqual([
      { data: { workspaceId: WORKSPACE, threadId: 't1', messageId: newestA.id }, options: { jobId: `reply:${newestA.id}` } },
      { data: { workspaceId: WORKSPACE, threadId: 't2', messageId: newestB.id }, options: { jobId: `reply:${newestB.id}` } },
    ]);
    // One transaction for the listing's retention, then one per thread.
    expect(conversations.transactions).toEqual(['begin', 'commit', 'begin', 'commit', 'begin', 'commit']);
  });

  it('queues nothing and supersedes nothing on a resync once the message has a draft', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    await service.syncListing(listing(), adapter);
    conversations.answered.add(conversations.byExternalId('a1').id);
    queue.jobs.length = 0;
    conversations.superseded.length = 0;

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 0 });
    expect(queue.jobs).toEqual([]);
    expect(conversations.superseded).toEqual([]);
  });

  it('reenqueuesUnansweredMessageAfterLostEnqueue', async () => {
    const { conversations, queue, service, failures } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    queue.failNext = true;

    await service.syncListing(listing(), adapter);
    expect(queue.jobs).toEqual([]);
    expect(failures).toEqual([{ listingId: 'l1', code: CONVERSATION_THREAD_SYNC_FAILED }]);

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 0 });
    const message = conversations.byExternalId('a1');
    expect(queue.jobs).toEqual([
      { data: { workspaceId: WORKSPACE, threadId: 't1', messageId: message.id }, options: { jobId: `reply:${message.id}` } },
    ]);
  });

  it('enqueuesPreviouslyTruncatedThreadOnceComplete', async () => {
    const { conversations, queue, service } = await setup();
    const threads = [thread('a', 3)];
    const adapter = adapterWith(threads, { a: [buyer('a1', 1), buyer('a2', 2)] });

    await service.syncListing(listing(), adapter);
    expect(conversations.messages.map((m) => m.externalMessageId)).toEqual(['a1', 'a2']);
    expect(queue.jobs).toEqual([]);

    threads[0] = thread('a', 2);
    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 0 });
    expect(queue.jobs.map((j) => j.data.messageId)).toEqual([conversations.byExternalId('a2').id]);
  });

  it('supersedes the pending draft when a newer buyer message arrives and queues a run for it', async () => {
    const { conversations, queue, service } = await setup();
    const messages: Record<string, MarketplaceMessage[]> = { a: [buyer('a1', 1)] };
    const adapter = adapterWith([thread('a')], messages);
    await service.syncListing(listing(), adapter);
    conversations.answered.add(conversations.byExternalId('a1').id);
    queue.jobs.length = 0;
    conversations.superseded.length = 0;
    messages.a = [buyer('a1', 1), buyer('a2', 5)];

    await service.syncListing(listing(), adapter);

    expect(conversations.superseded).toEqual(['t1']);
    expect(queue.jobs.map((j) => j.data.messageId)).toEqual([conversations.byExternalId('a2').id]);
  });

  it('does not supersede or queue when the newest message is from the seller', async () => {
    const { conversations, queue, service } = await setup();
    const messages: Record<string, MarketplaceMessage[]> = { a: [buyer('a1', 1)] };
    const adapter = adapterWith([thread('a')], messages);
    await service.syncListing(listing(), adapter);
    queue.jobs.length = 0;
    conversations.superseded.length = 0;
    messages.a = [buyer('a1', 1), seller('a2', 2)];

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 0 });
    expect(conversations.superseded).toEqual([]);
    expect(queue.jobs).toEqual([]);
  });

  it('queues no run for a suspicious thread', async () => {
    const { conversations, queue, service } = await setup();
    const messages: Record<string, MarketplaceMessage[]> = { a: [buyer('a1', 1)] };
    const adapter = adapterWith([thread('a')], messages);
    await service.syncListing(listing(), adapter);
    const stored = conversations.threads.get('t1')!;
    conversations.threads.set('t1', { ...stored, status: 'suspicious', suspiciousReasons: ['foreign_link'] });
    queue.jobs.length = 0;
    messages.a = [buyer('a1', 1), buyer('a2', 2)];

    await service.syncListing(listing(), adapter);
    expect(queue.jobs).toEqual([]);
  });

  it('stores a truncated thread but queues no run for it', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a', 5), thread('b', 1)], { a: [buyer('a1', 1), buyer('a2', 2)], b: [buyer('b1', 1)] });

    const result = await service.syncListing(listing(), adapter);

    expect(result).toEqual({ newBuyerMessages: 3 });
    expect(conversations.messages.map((m) => m.externalMessageId)).toEqual(['a1', 'a2', 'b1']);
    expect(queue.jobs.map((j) => j.data.threadId)).toEqual(['t2']);
  });

  it('keeps syncing the other threads when one fails and reports it by code', async () => {
    const { conversations, queue, service, failures } = await setup();
    const adapter = adapterWith([thread('a'), thread('b')], { b: [buyer('b1', 1, 'secret buyer text')] });

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 1 });
    expect(conversations.messages.map((m) => m.externalMessageId)).toEqual(['b1']);
    expect(queue.jobs).toHaveLength(1);
    expect(failures).toEqual([{ listingId: 'l1', code: CONVERSATION_THREAD_SYNC_FAILED }]);
    expect(JSON.stringify(failures)).not.toContain('unreadable');
  });

  it('starts retention when the listing is no longer live', async () => {
    const { conversations, service } = await setup();
    await service.syncListing(listing({ status: 'expired' }), adapterWith([thread('a')], { a: [buyer('a1', 1)] }));
    expect(conversations.threads.get('t1')?.retentionStartsAt).toEqual(NOW);
  });

  it('startsRetentionForListingLeftLive', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    await service.syncListing(listing(), adapter);
    expect(conversations.threads.get('t1')?.retentionStartsAt).toBeNull();
    adapter.listThreads.mockClear();
    queue.jobs.length = 0;

    expect(await service.syncListing(listing({ status: 'error' }), adapter)).toEqual({ newBuyerMessages: 0 });

    expect(conversations.threads.get('t1')?.retentionStartsAt).toEqual(NOW);
    expect(adapter.listThreads).not.toHaveBeenCalled();
    expect(queue.jobs).toEqual([]);
  });

  it('starts retention when the product is sold', async () => {
    const { conversations, service } = await setup({ productStatus: 'sold' });
    await service.syncListing(listing(), adapterWith([thread('a')], { a: [buyer('a1', 1)] }));
    expect(conversations.threads.get('t1')?.retentionStartsAt).toEqual(NOW);
  });

  it('does not start retention for a live listing of an unsold product', async () => {
    const { conversations, service } = await setup();
    await service.syncListing(listing(), adapterWith([thread('a')], { a: [buyer('a1', 1)] }));
    expect(conversations.threads.get('t1')?.retentionStartsAt).toBeNull();
  });

  it.each([
    ['a draft listing', listing({ status: 'draft' })],
    ['a listing in error', listing({ status: 'error' })],
    ['a listing without an advert id', listing({ marketplaceListingId: null })],
  ])('reads no threads for %s', async (_name, input) => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    expect(await service.syncListing(input, adapter)).toEqual({ newBuyerMessages: 0 });
    expect(adapter.listThreads).not.toHaveBeenCalled();
    expect(conversations.threads.size).toBe(0);
    expect(queue.jobs).toEqual([]);
  });

  it('stopsRetentionWhenListingIsLiveAgain', async () => {
    const { conversations, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    await service.syncListing(listing({ status: 'expired' }), adapter);
    const stored = conversations.threads.get('t1')!;
    conversations.threads.set('t1', { ...stored, textPurgedAt: NOW });
    expect(stored.retentionStartsAt).toEqual(NOW);

    await service.syncListing(listing(), adapter);

    expect(conversations.threads.get('t1')?.retentionStartsAt).toBeNull();
    expect(conversations.threads.get('t1')?.textPurgedAt).toBeNull();
  });

  it('keeps retention for a live listing of a sold product', async () => {
    const { conversations, service } = await setup({ productStatus: 'sold' });
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    await service.syncListing(listing(), adapter);
    await service.syncListing(listing(), adapter);
    expect(conversations.threads.get('t1')?.retentionStartsAt).toEqual(NOW);
  });

  it('countsSkippedMessagesTowardsTheTotal', async () => {
    const { conversations, queue, service } = await setup();
    // OLX counts an attachment-only message the adapter does not return as text.
    const adapter = adapterWith([thread('a', 3)], { a: [buyer('a1', 1), buyer('a3', 3)] }, { a: 1 });

    await service.syncListing(listing(), adapter);

    expect(queue.jobs.map((j) => j.data.messageId)).toEqual([conversations.byExternalId('a3').id]);
  });

  it('queuesNoRunForAnOldBuyerMessage', async () => {
    const { conversations, queue, service } = await setup();
    const old = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000);
    const recent = new Date(NOW.getTime() - 13 * 24 * 60 * 60 * 1000);
    const adapter = adapterWith([thread('a'), thread('b')], {
      a: [{ externalMessageId: 'a1', direction: 'buyer', text: 'old', sentAt: old }],
      b: [{ externalMessageId: 'b1', direction: 'buyer', text: 'recent', sentAt: recent }],
    });

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 2 });

    expect(conversations.messages.map((m) => m.externalMessageId)).toEqual(['a1', 'b1']);
    expect(queue.jobs.map((j) => j.data.messageId)).toEqual([conversations.byExternalId('b1').id]);
  });

  it('reads no threads with an adapter that cannot', async () => {
    const { queue, service } = await setup();
    expect(await service.syncListing(listing(), {})).toEqual({ newBuyerMessages: 0 });
    expect(queue.jobs).toEqual([]);
  });
});
