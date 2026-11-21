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
import { ConversationSyncService, type ConversationSyncListing } from '../ConversationSyncService';

const NOW = new Date('2026-11-21T12:00:00Z');
const WORKSPACE = 'w1';

class FakeConversations {
  readonly threads = new Map<string, ConversationThread>();
  readonly messages: ConversationMessage[] = [];
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
}

class RecordingQueue implements IJobQueue<ConversationReplyJob> {
  readonly jobs: Array<{ data: ConversationReplyJob; options?: JobEnqueueOptions }> = [];
  async enqueue(data: ConversationReplyJob, options?: JobEnqueueOptions): Promise<void> {
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

function adapterWith(threads: MarketplaceThread[], messages: Record<string, MarketplaceMessage[]>) {
  return {
    listThreads: jest.fn(async () => threads),
    listThreadMessages: jest.fn(async (id: string) => messages[id] ?? []),
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
  });
  return { conversations, queue, service };
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
    expect(conversations.messages.find((m) => m.externalMessageId === 'a3')?.textHash)
      .toBe(normalizedTextHash('Is it  AVAILABLE?'));
    const newestA = conversations.messages.find((m) => m.externalMessageId === 'a3')!;
    const newestB = conversations.messages.find((m) => m.externalMessageId === 'b1')!;
    expect(queue.jobs).toEqual([
      { data: { workspaceId: WORKSPACE, threadId: 't1', messageId: newestA.id }, options: { jobId: `reply:${newestA.id}` } },
      { data: { workspaceId: WORKSPACE, threadId: 't2', messageId: newestB.id }, options: { jobId: `reply:${newestB.id}` } },
    ]);
    // One transaction per thread.
    expect(conversations.transactions).toEqual(['begin', 'commit', 'begin', 'commit']);
  });

  it('queues nothing and supersedes nothing on a resync without new messages', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    await service.syncListing(listing(), adapter);
    queue.jobs.length = 0;
    conversations.superseded.length = 0;

    expect(await service.syncListing(listing(), adapter)).toEqual({ newBuyerMessages: 0 });
    expect(queue.jobs).toEqual([]);
    expect(conversations.superseded).toEqual([]);
  });

  it('supersedes the pending draft when a newer buyer message arrives and queues a run for it', async () => {
    const { conversations, queue, service } = await setup();
    const messages: Record<string, MarketplaceMessage[]> = { a: [buyer('a1', 1)] };
    const adapter = adapterWith([thread('a')], messages);
    await service.syncListing(listing(), adapter);
    queue.jobs.length = 0;
    conversations.superseded.length = 0;
    messages.a = [buyer('a1', 1), buyer('a2', 5)];

    await service.syncListing(listing(), adapter);

    expect(conversations.superseded).toEqual(['t1']);
    const newest = conversations.messages.find((m) => m.externalMessageId === 'a2')!;
    expect(queue.jobs.map((j) => j.data.messageId)).toEqual([newest.id]);
  });

  it('does not supersede or queue when only a seller message is new', async () => {
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

  it('stores a truncated thread but queues no run for it', async () => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a', 5), thread('b', 1)], { a: [buyer('a1', 1), buyer('a2', 2)], b: [buyer('b1', 1)] });

    const result = await service.syncListing(listing(), adapter);

    expect(result).toEqual({ newBuyerMessages: 3 });
    expect(conversations.messages.map((m) => m.externalMessageId)).toEqual(['a1', 'a2', 'b1']);
    expect(queue.jobs.map((j) => j.data.threadId)).toEqual(['t2']);
  });

  it('starts retention when the listing is no longer live', async () => {
    const { conversations, service } = await setup();
    await service.syncListing(listing({ status: 'expired' }), adapterWith([thread('a')], { a: [buyer('a1', 1)] }));
    expect(conversations.threads.get('t1')?.retentionStartsAt).toEqual(NOW);
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
  ])('skips %s', async (_name, input) => {
    const { conversations, queue, service } = await setup();
    const adapter = adapterWith([thread('a')], { a: [buyer('a1', 1)] });
    expect(await service.syncListing(input, adapter)).toEqual({ newBuyerMessages: 0 });
    expect(adapter.listThreads).not.toHaveBeenCalled();
    expect(conversations.threads.size).toBe(0);
    expect(queue.jobs).toEqual([]);
  });

  it('skips an adapter without thread reading', async () => {
    const { queue, service } = await setup();
    expect(await service.syncListing(listing(), {})).toEqual({ newBuyerMessages: 0 });
    expect(queue.jobs).toEqual([]);
  });
});
