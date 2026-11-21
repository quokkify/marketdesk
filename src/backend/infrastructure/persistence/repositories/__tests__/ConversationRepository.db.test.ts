import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ConversationRepository } from '../ConversationRepository';
import type { NewConversationMessage } from '../../../../domain/repositories/interfaces/IConversationRepository';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

const TABLES = [
  'workspaces',
  'listings',
  'products',
  'conversation_threads',
  'conversation_messages',
  'reply_drafts',
];

// The migration text runs unchanged except that its tables are created as session TEMP tables,
// so the shared database is never written.
function migrationAsTemp(): string {
  const sql = ['047_conversations.sql', '048_reply_draft_source.sql', '049_reply_drafts_one_pending.sql']
    .map((file) => fs.readFileSync(path.resolve(process.cwd(), 'src/backend/persistence/migrations', file), 'utf8'))
    .join('\n');
  return sql.replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMP TABLE');
}

const message = (externalMessageId: string, overrides: Partial<NewConversationMessage> = {}): NewConversationMessage => ({
  externalMessageId,
  direction: 'buyer',
  text: `text ${externalMessageId}`,
  textHash: `hash-${externalMessageId}`,
  sentAt: new Date('2026-11-20T10:00:00Z'),
  ...overrides,
});

describeDb('ConversationRepository (PostgreSQL TEMP tables)', () => {
  let ready = false;
  let pool: Pool;
  let client: PoolClient;
  let closePool: () => Promise<void>;
  let repo: ConversationRepository;
  let workspaceId: string;
  let listingId: string;
  let productId: string;

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../../config/database');
      pool = await db.getPool();
      closePool = db.closePool;
      client = await pool.connect();
      ready = true;
    } catch (error) {
      if (requireDatabaseTests) throw error;
      ready = false;
    }
  });

  afterAll(async () => {
    client?.release();
    await closePool?.();
  });

  beforeEach(async () => {
    if (!ready) return;
    for (const table of [...TABLES].reverse()) {
      await client.query(`DROP TABLE IF EXISTS pg_temp.${table} CASCADE`);
    }
    await client.query('CREATE TEMP TABLE workspaces (id uuid PRIMARY KEY)');
    await client.query('CREATE TEMP TABLE products (id uuid PRIMARY KEY)');
    await client.query('CREATE TEMP TABLE listings (id uuid PRIMARY KEY)');
    await client.query(migrationAsTemp());
    const persistence = await client.query<{ relname: string; relpersistence: string }>(
      `SELECT relname, relpersistence FROM pg_class
        WHERE oid = ANY (ARRAY[${TABLES.map((t) => `'${t}'::regclass`).join(',')}])`,
    );
    expect(persistence.rows).toHaveLength(TABLES.length);
    expect(persistence.rows.every((row) => row.relpersistence === 't')).toBe(true);

    workspaceId = randomUUID();
    listingId = randomUUID();
    productId = randomUUID();
    await client.query('INSERT INTO workspaces (id) VALUES ($1)', [workspaceId]);
    await client.query('INSERT INTO listings (id) VALUES ($1)', [listingId]);
    await client.query('INSERT INTO products (id) VALUES ($1)', [productId]);
    repo = new ConversationRepository(pool, client);
  });

  const newThread = (externalThreadId = 'ext-1') =>
    repo.upsertThread({ workspaceId, listingId, productId, externalThreadId, externalBuyerId: 'buyer-1' });

  // The repository's client contract: the caller owns the transaction.
  const inTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
    await client.query('BEGIN');
    try {
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };

  it('upsertMessagesReturnsOnlyNew', async () => {
    const thread = await newThread();
    const first = await repo.upsertMessages(thread.id, [message('m1'), message('m2')]);
    expect(first.map((m) => m.externalMessageId).sort()).toEqual(['m1', 'm2']);

    const again = await repo.upsertMessages(thread.id, [message('m1'), message('m2')]);
    expect(again).toEqual([]);

    const mixed = await repo.upsertMessages(thread.id, [message('m2'), message('m3')]);
    expect(mixed.map((m) => m.externalMessageId)).toEqual(['m3']);
  });

  it('updateDraftIsCompareAndSet', async () => {
    const thread = await newThread();
    const [msg] = await repo.upsertMessages(thread.id, [message('m1')]);
    const draft = await repo.insertDraft({ threadId: thread.id, answersMessageId: msg.id, proposedText: 'hi' });
    expect(draft.status).toBe('pending');

    expect(await repo.updateDraft(draft.id, { status: 'sending', attemptKey: 'k1' }, 'pending')).toBe(true);
    expect(await repo.updateDraft(draft.id, { status: 'sent' }, 'pending')).toBe(false);

    const stored = await repo.findDraft(draft.id, thread.id);
    expect(stored?.status).toBe('sending');
    expect(stored?.attemptKey).toBe('k1');
    expect(await repo.findDraft(draft.id, randomUUID())).toBeNull();
  });

  it('purgeExpiredTextKeepsCounters', async () => {
    const thread = await repo.upsertThread({
      workspaceId,
      listingId,
      productId,
      externalThreadId: 'ext-old',
      retentionStartsAt: new Date('2026-01-01T00:00:00Z'),
    });
    const fresh = await repo.upsertThread({
      workspaceId,
      listingId,
      productId,
      externalThreadId: 'ext-fresh',
      retentionStartsAt: new Date('2026-11-01T00:00:00Z'),
    });
    const [msg] = await repo.upsertMessages(thread.id, [message('m1')]);
    await repo.upsertMessages(fresh.id, [message('f1')]);
    const draft = await repo.insertDraft({ threadId: thread.id, answersMessageId: msg.id, proposedText: 'proposal' });
    await repo.updateDraft(draft.id, { status: 'sent', sentText: 'edited' }, 'pending');

    const purged = await repo.purgeExpiredText(new Date('2026-06-01T00:00:00Z'));
    expect(purged).toBe(1);
    expect(await repo.purgeExpiredText(new Date('2026-06-01T00:00:00Z'))).toBe(0);

    const messages = await repo.recentMessages(thread.id, 10);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBeNull();
    expect(messages[0].textHash).toBeNull();
    const stored = await repo.findDraft(draft.id, thread.id);
    expect(stored?.proposedText).toBeNull();
    expect(stored?.sentText).toBeNull();
    expect(stored?.status).toBe('sent');
    expect((await repo.findThreadForWorkspace(thread.id, workspaceId))?.textPurgedAt).toBeInstanceOf(Date);

    const untouched = await repo.recentMessages(fresh.id, 10);
    expect(untouched[0].text).toBe('text f1');
    expect((await repo.findThreadForWorkspace(fresh.id, workspaceId))?.textPurgedAt).toBeNull();
  });

  it('purgesLateMessageInAlreadyPurgedThread', async () => {
    const thread = await repo.upsertThread({
      workspaceId,
      listingId,
      productId,
      externalThreadId: 'ext-late',
      retentionStartsAt: new Date('2026-01-01T00:00:00Z'),
    });
    const cutoff = new Date('2026-06-01T00:00:00Z');
    await repo.upsertMessages(thread.id, [message('m1')]);
    expect(await repo.purgeExpiredText(cutoff)).toBe(1);
    const firstPurge = (await repo.findThreadForWorkspace(thread.id, workspaceId))?.textPurgedAt;
    expect(firstPurge).toBeInstanceOf(Date);

    await repo.upsertMessages(thread.id, [message('m2')]);
    expect(await repo.purgeExpiredText(cutoff)).toBe(1);

    const messages = await repo.recentMessages(thread.id, 10);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.text === null && m.textHash === null)).toBe(true);
    expect(await repo.purgeExpiredText(cutoff)).toBe(0);
  });

  it('threadsAreWorkspaceScoped', async () => {
    const thread = await newThread();
    const otherWorkspace = randomUUID();
    await client.query('INSERT INTO workspaces (id) VALUES ($1)', [otherWorkspace]);

    expect(await repo.findThreadForWorkspace(thread.id, otherWorkspace)).toBeNull();
    expect(await repo.listThreadsForProduct(productId, otherWorkspace)).toEqual([]);
    expect((await repo.listThreadsForProduct(productId, workspaceId)).map((t) => t.id)).toEqual([thread.id]);

    const sameExternal = await repo.upsertThread({
      workspaceId: otherWorkspace,
      listingId,
      productId,
      externalThreadId: 'ext-1',
    });
    expect(sameExternal.id).not.toBe(thread.id);
  });

  it('upsertThread keeps one row per external id and updates its status', async () => {
    const thread = await newThread();
    const again = await repo.upsertThread({
      workspaceId,
      listingId,
      productId,
      externalThreadId: 'ext-1',
      status: 'suspicious',
      suspiciousReasons: ['foreign_link'],
      lastExternalMessageId: 'm9',
    });
    expect(again.id).toBe(thread.id);
    expect(again.status).toBe('suspicious');
    expect(again.suspiciousReasons).toEqual(['foreign_link']);
    expect(again.lastExternalMessageId).toBe('m9');
    expect(again.externalBuyerId).toBe('buyer-1');
  });

  it('counts hashes, buyer messages, reply runs, awaiting threads and supersedes pending drafts', async () => {
    const thread = await newThread();
    const old = new Date('2026-11-01T00:00:00Z');
    const since = new Date('2026-11-10T00:00:00Z');
    const [m1, m2] = await repo.upsertMessages(thread.id, [
      message('m1', { textHash: 'same', sentAt: old }),
      message('m2', { textHash: 'same', sentAt: new Date('2026-11-20T00:00:00Z') }),
      message('m3', { direction: 'seller', textHash: 'same', sentAt: new Date('2026-11-20T01:00:00Z') }),
    ]);
    expect(await repo.countTextHashInWorkspace(workspaceId, 'same', since)).toBe(1);
    expect(await repo.countTextHashInWorkspace(randomUUID(), 'same', since)).toBe(0);
    expect(await repo.countBuyerMessagesSince(thread.id, since)).toBe(1);

    const d1 = await repo.insertDraft({ threadId: thread.id, answersMessageId: m1.id, status: 'failed' });
    const d2 = await repo.insertDraft({ threadId: thread.id, answersMessageId: m2.id });
    expect(await repo.countReplyRunsToday(workspaceId, new Date(Date.now() - 60_000))).toBe(2);
    expect(await repo.countReplyRunsToday(workspaceId, new Date(Date.now() + 60_000))).toBe(0);
    expect(await repo.awaitingReplyCounts(workspaceId)).toEqual({ [productId]: 1 });

    await repo.supersedePendingDrafts(thread.id);
    expect((await repo.findDraft(d1.id, thread.id))?.status).toBe('failed');
    expect((await repo.findDraft(d2.id, thread.id))?.status).toBe('superseded');
    expect(await repo.awaitingReplyCounts(workspaceId)).toEqual({});
  });

  it('counts repeated text over buyer messages only', async () => {
    const thread = await newThread();
    const other = await newThread('ext-2');
    const at = new Date('2026-11-20T00:00:00Z');
    await repo.upsertMessages(thread.id, [
      message('b1', { textHash: 'dup', sentAt: at }),
      message('s1', { direction: 'seller', textHash: 'dup', sentAt: at }),
    ]);
    await repo.upsertMessages(other.id, [
      message('b2', { textHash: 'dup', sentAt: at }),
      message('s2', { direction: 'seller', textHash: 'dup', sentAt: at }),
    ]);
    expect(await repo.countTextHashInWorkspace(workspaceId, 'dup', new Date('2026-11-01T00:00:00Z'))).toBe(2);
  });

  it('stores the draft source and the failure reason', async () => {
    const thread = await newThread();
    const [msg] = await repo.upsertMessages(thread.id, [message('m1')]);
    const failed = await repo.insertDraft({
      threadId: thread.id, answersMessageId: msg.id, status: 'failed', failureReason: 'link', source: 'offline',
    });
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'link', source: 'offline', proposedText: null });
    const plain = await repo.insertDraft({ threadId: thread.id, answersMessageId: msg.id });
    expect(plain.source).toBeNull();
    expect((await repo.findDraft(failed.id, thread.id))?.source).toBe('offline');
  });

  it('storesDecimalFilledPrice', async () => {
    const thread = await newThread();
    const [msg] = await repo.upsertMessages(thread.id, [message('m1')]);
    const draft = await repo.insertDraft({ threadId: thread.id, answersMessageId: msg.id, filledPrice: 72.5 });
    expect(draft.filledPrice).toBe(72.5);
    expect(await repo.updateDraft(draft.id, { filledPrice: 80.99 }, 'pending')).toBe(true);
    expect((await repo.findDraft(draft.id, thread.id))?.filledPrice).toBe(80.99);
  });

  it('replacePendingDraftKeepsOnePending', async () => {
    const thread = await newThread();
    const [m1] = await repo.upsertMessages(thread.id, [message('m1', { sentAt: new Date('2026-11-20T10:00:00Z') })]);
    const first = await inTransaction(() =>
      repo.replacePendingDraft(thread.id, m1.id, { answersMessageId: m1.id, proposedText: 'one' }));
    const [m2] = await repo.upsertMessages(thread.id, [message('m2', { sentAt: new Date('2026-11-20T11:00:00Z') })]);
    const second = await inTransaction(() => repo.replacePendingDraft(thread.id, m2.id, {
      answersMessageId: m2.id, proposedText: 'two', source: 'hermes',
    }));
    expect(second).toMatchObject({ status: 'pending', proposedText: 'two', source: 'hermes' });
    expect((await repo.findDraft(first!.id, thread.id))?.status).toBe('superseded');

    await expect(repo.insertDraft({ threadId: thread.id, answersMessageId: m2.id, proposedText: 'dup' }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('replacePendingDraftRefusesStaleMessage', async () => {
    const thread = await newThread();
    const [m1] = await repo.upsertMessages(thread.id, [message('m1', { sentAt: new Date('2026-11-20T10:00:00Z') })]);
    const kept = await inTransaction(() =>
      repo.replacePendingDraft(thread.id, m1.id, { answersMessageId: m1.id, proposedText: 'one' }));
    await repo.upsertMessages(thread.id, [
      message('s1', { direction: 'seller', sentAt: new Date('2026-11-20T11:00:00Z') }),
    ]);
    expect(await inTransaction(() =>
      repo.replacePendingDraft(thread.id, m1.id, { answersMessageId: m1.id, proposedText: 'late' }))).toBeNull();
    expect((await repo.findDraft(kept!.id, thread.id))?.status).toBe('pending');
  });

  it('replacePendingDraftMapsUniqueViolationToNull', async () => {
    const thread = await newThread();
    const [m1] = await repo.upsertMessages(thread.id, [message('m1')]);
    const kept = await repo.insertDraft({ threadId: thread.id, answersMessageId: m1.id, proposedText: 'one' });
    // A session-local trigger makes the supersede miss the pending row, so the insert hits the unique index.
    await client.query('CREATE OR REPLACE FUNCTION pg_temp.keep_pending() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$');
    await client.query(
      'CREATE TRIGGER keep_pending BEFORE UPDATE ON reply_drafts FOR EACH ROW EXECUTE FUNCTION pg_temp.keep_pending()',
    );

    await client.query('BEGIN');
    try {
      expect(await repo.replacePendingDraft(thread.id, m1.id, { answersMessageId: m1.id, proposedText: 'two' })).toBeNull();
      const { rows } = await client.query<{ status: string }>(
        'SELECT status FROM reply_drafts WHERE thread_id = $1', [thread.id],
      );
      expect(rows.map((r) => r.status)).toEqual(['pending']);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    expect((await repo.findDraft(kept.id, thread.id))?.proposedText).toBe('one');
  });

  it('upsertThreadKeepsFirstRetentionStart', async () => {
    const first = new Date('2026-11-01T00:00:00Z');
    await repo.upsertThread({ workspaceId, listingId, productId, externalThreadId: 'ext-r' });
    const started = await repo.upsertThread({
      workspaceId, listingId, productId, externalThreadId: 'ext-r', retentionStartsAt: first,
    });
    expect(started.retentionStartsAt).toEqual(first);
    const later = await repo.upsertThread({
      workspaceId, listingId, productId, externalThreadId: 'ext-r', retentionStartsAt: new Date('2026-11-20T00:00:00Z'),
    });
    expect(later.retentionStartsAt).toEqual(first);
  });

  it('latestDraftSkipsSupersededDrafts', async () => {
    const thread = await newThread();
    expect(await repo.latestDraft(thread.id)).toBeNull();
    const [m1] = await repo.upsertMessages(thread.id, [message('m1')]);
    const old = await repo.insertDraft({ threadId: thread.id, answersMessageId: m1.id, proposedText: 'old' });
    expect((await repo.latestDraft(thread.id))?.id).toBe(old.id);
    await repo.supersedePendingDrafts(thread.id);
    expect(await repo.latestDraft(thread.id)).toBeNull();
    const failed = await repo.insertDraft({
      threadId: thread.id, answersMessageId: m1.id, status: 'failed', failureReason: 'link',
    });
    expect((await repo.latestDraft(thread.id))?.id).toBe(failed.id);
  });

  it('newestUnansweredBuyerMessageNeedsBuyerLatestWithoutDraft', async () => {
    const thread = await newThread();
    expect(await repo.newestUnansweredBuyerMessage(thread.id)).toBeNull();
    const [m1] = await repo.upsertMessages(thread.id, [message('m1', { sentAt: new Date('2026-11-20T10:00:00Z') })]);
    expect((await repo.newestUnansweredBuyerMessage(thread.id))?.id).toBe(m1.id);

    await repo.insertDraft({ threadId: thread.id, answersMessageId: m1.id, status: 'failed', failureReason: 'link' });
    expect(await repo.newestUnansweredBuyerMessage(thread.id)).toBeNull();

    const [m2] = await repo.upsertMessages(thread.id, [message('m2', { sentAt: new Date('2026-11-20T11:00:00Z') })]);
    expect((await repo.newestUnansweredBuyerMessage(thread.id))?.id).toBe(m2.id);

    await repo.upsertMessages(thread.id, [message('m3', { direction: 'seller', sentAt: new Date('2026-11-20T12:00:00Z') })]);
    expect(await repo.newestUnansweredBuyerMessage(thread.id)).toBeNull();
  });

  it('startRetentionForListingSetsOnlyUnsetThreadsOfThatListingAndWorkspace', async () => {
    const earlier = new Date('2026-11-01T00:00:00Z');
    const at = new Date('2026-11-21T00:00:00Z');
    const open = await newThread('ext-open');
    const kept = await repo.upsertThread({
      workspaceId, listingId, productId, externalThreadId: 'ext-kept', retentionStartsAt: earlier,
    });
    const otherListing = randomUUID();
    await client.query('INSERT INTO listings (id) VALUES ($1)', [otherListing]);
    const other = await repo.upsertThread({ workspaceId, listingId: otherListing, productId, externalThreadId: 'ext-other' });

    expect(await repo.startRetentionForListing(listingId, randomUUID(), at)).toBe(0);
    expect(await repo.startRetentionForListing(listingId, workspaceId, at)).toBe(1);
    expect(await repo.startRetentionForListing(listingId, workspaceId, new Date('2026-11-22T00:00:00Z'))).toBe(0);

    const byId = async (id: string) => (await repo.findThreadForWorkspace(id, workspaceId))?.retentionStartsAt;
    expect(await byId(open.id)).toEqual(at);
    expect(await byId(kept.id)).toEqual(earlier);
    expect(await byId(other.id)).toBeNull();
  });
});
