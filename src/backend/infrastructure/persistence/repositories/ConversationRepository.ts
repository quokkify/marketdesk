import type { Pool, PoolClient } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type {
  ConversationMessage,
  ConversationThread,
  ReplyDraft,
  ScreeningReason,
} from '../../../domain/conversations/types';
import type {
  IConversationRepository,
  NewConversationMessage,
  NewConversationThread,
  NewReplyDraft,
  ReplyDraftPatch,
} from '../../../domain/repositories/interfaces/IConversationRepository';

interface ThreadRow {
  id: string;
  workspace_id: string;
  listing_id: string;
  product_id: string;
  external_thread_id: string;
  external_buyer_id: string | null;
  status: ConversationThread['status'];
  suspicious_reasons: ScreeningReason[];
  last_external_message_id: string | null;
  retention_starts_at: Date | null;
  text_purged_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  thread_id: string;
  external_message_id: string;
  direction: ConversationMessage['direction'];
  text: string | null;
  text_hash: string | null;
  sent_at: Date;
}

interface DraftRow {
  id: string;
  thread_id: string;
  answers_message_id: string;
  intent: ReplyDraft['intent'];
  proposed_text: string | null;
  sent_text: string | null;
  filled_price: string | null;
  status: ReplyDraft['status'];
  failure_reason: string | null;
  source: ReplyDraft['source'];
  attempt_key: string | null;
  attempt_started_at: Date | null;
  external_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const toThread = (row: ThreadRow): ConversationThread => ({
  id: row.id,
  workspaceId: row.workspace_id,
  listingId: row.listing_id,
  productId: row.product_id,
  externalThreadId: row.external_thread_id,
  externalBuyerId: row.external_buyer_id,
  status: row.status,
  suspiciousReasons: row.suspicious_reasons,
  lastExternalMessageId: row.last_external_message_id,
  retentionStartsAt: row.retention_starts_at,
  textPurgedAt: row.text_purged_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMessage = (row: MessageRow): ConversationMessage => ({
  id: row.id,
  threadId: row.thread_id,
  externalMessageId: row.external_message_id,
  direction: row.direction,
  text: row.text,
  textHash: row.text_hash,
  sentAt: row.sent_at,
});

const toDraft = (row: DraftRow): ReplyDraft => ({
  id: row.id,
  threadId: row.thread_id,
  answersMessageId: row.answers_message_id,
  intent: row.intent,
  proposedText: row.proposed_text,
  sentText: row.sent_text,
  filledPrice: row.filled_price === null ? null : Number(row.filled_price) / MINOR_UNITS,
  status: row.status,
  failureReason: row.failure_reason,
  source: row.source,
  attemptKey: row.attempt_key,
  attemptStartedAt: row.attempt_started_at,
  externalMessageId: row.external_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// filled_price is stored in minor units; the domain keeps major units.
const MINOR_UNITS = 100;
const toMinor = (price: number | null | undefined): number | null =>
  price === null || price === undefined ? null : Math.round(price * MINOR_UNITS);
const UNIQUE_VIOLATION = '23505';

// Patch keys to columns; the column names are fixed here, never taken from input.
const DRAFT_PATCH_COLUMNS: Record<keyof ReplyDraftPatch, string> = {
  intent: 'intent',
  proposedText: 'proposed_text',
  sentText: 'sent_text',
  filledPrice: 'filled_price',
  status: 'status',
  failureReason: 'failure_reason',
  attemptKey: 'attempt_key',
  attemptStartedAt: 'attempt_started_at',
  externalMessageId: 'external_message_id',
};

export class ConversationRepository implements IConversationRepository {
  private readonly queryClient?: PoolClient | Pool;

  constructor(private readonly pool?: Pool, private readonly client?: PoolClient) {
    this.queryClient = client || pool;
  }

  async upsertThread(thread: NewConversationThread): Promise<ConversationThread> {
    const { rows } = await query<ThreadRow>(
      `INSERT INTO conversation_threads
         (workspace_id, listing_id, product_id, external_thread_id, external_buyer_id, status,
          suspicious_reasons, last_external_message_id, retention_starts_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'open'), COALESCE($7::text[], '{}'), $8, $9)
       ON CONFLICT (workspace_id, external_thread_id) DO UPDATE SET
         external_buyer_id = COALESCE($5, conversation_threads.external_buyer_id),
         status = COALESCE($6, conversation_threads.status),
         suspicious_reasons = COALESCE($7::text[], conversation_threads.suspicious_reasons),
         last_external_message_id = COALESCE($8, conversation_threads.last_external_message_id),
         retention_starts_at = COALESCE($9, conversation_threads.retention_starts_at),
         updated_at = now()
       RETURNING *`,
      [
        thread.workspaceId,
        thread.listingId,
        thread.productId,
        thread.externalThreadId,
        thread.externalBuyerId ?? null,
        thread.status ?? null,
        thread.suspiciousReasons ?? null,
        thread.lastExternalMessageId ?? null,
        thread.retentionStartsAt ?? null,
      ],
      this.queryClient,
    );
    return toThread(rows[0]);
  }

  async findThreadForWorkspace(threadId: string, workspaceId: string): Promise<ConversationThread | null> {
    const { rows } = await query<ThreadRow>(
      'SELECT * FROM conversation_threads WHERE id = $1 AND workspace_id = $2',
      [threadId, workspaceId],
      this.queryClient,
    );
    return rows[0] ? toThread(rows[0]) : null;
  }

  async listThreadsForProduct(productId: string, workspaceId: string): Promise<ConversationThread[]> {
    const { rows } = await query<ThreadRow>(
      'SELECT * FROM conversation_threads WHERE product_id = $1 AND workspace_id = $2 ORDER BY updated_at DESC',
      [productId, workspaceId],
      this.queryClient,
    );
    return rows.map(toThread);
  }

  async upsertMessages(threadId: string, messages: NewConversationMessage[]): Promise<ConversationMessage[]> {
    const inserted: ConversationMessage[] = [];
    for (const m of messages) {
      const { rows } = await query<MessageRow>(
        `INSERT INTO conversation_messages (thread_id, external_message_id, direction, text, text_hash, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (thread_id, external_message_id) DO NOTHING
         RETURNING *`,
        [threadId, m.externalMessageId, m.direction, m.text, m.textHash, m.sentAt],
        this.queryClient,
      );
      if (rows[0]) inserted.push(toMessage(rows[0]));
    }
    return inserted;
  }

  async recentMessages(threadId: string, limit: number): Promise<ConversationMessage[]> {
    const { rows } = await query<MessageRow>(
      'SELECT * FROM conversation_messages WHERE thread_id = $1 ORDER BY sent_at DESC, id LIMIT $2',
      [threadId, limit],
      this.queryClient,
    );
    return rows.map(toMessage);
  }

  async countTextHashInWorkspace(workspaceId: string, hash: string, since: Date): Promise<number> {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM conversation_messages m
         JOIN conversation_threads t ON t.id = m.thread_id
        WHERE t.workspace_id = $1 AND m.direction = 'buyer' AND m.text_hash = $2 AND m.sent_at >= $3`,
      [workspaceId, hash, since],
      this.queryClient,
    );
    return Number(rows[0].count);
  }

  async countBuyerMessagesSince(threadId: string, since: Date): Promise<number> {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM conversation_messages
        WHERE thread_id = $1 AND direction = 'buyer' AND sent_at >= $2`,
      [threadId, since],
      this.queryClient,
    );
    return Number(rows[0].count);
  }

  async insertDraft(draft: NewReplyDraft, client: PoolClient | Pool | undefined = this.queryClient): Promise<ReplyDraft> {
    const { rows } = await query<DraftRow>(
      `INSERT INTO reply_drafts
         (thread_id, answers_message_id, intent, proposed_text, filled_price, status, failure_reason, source)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pending'), $7, $8)
       RETURNING *`,
      [
        draft.threadId,
        draft.answersMessageId,
        draft.intent ?? null,
        draft.proposedText ?? null,
        toMinor(draft.filledPrice),
        draft.status ?? null,
        draft.failureReason ?? null,
        draft.source ?? null,
      ],
      client,
    );
    return toDraft(rows[0]);
  }

  async findDraft(draftId: string, threadId: string): Promise<ReplyDraft | null> {
    const { rows } = await query<DraftRow>(
      'SELECT * FROM reply_drafts WHERE id = $1 AND thread_id = $2',
      [draftId, threadId],
      this.queryClient,
    );
    return rows[0] ? toDraft(rows[0]) : null;
  }

  async updateDraft(id: string, patch: ReplyDraftPatch, expectedStatus: ReplyDraft['status']): Promise<boolean> {
    const keys = (Object.keys(patch) as (keyof ReplyDraftPatch)[]).filter((k) => patch[k] !== undefined);
    const values: unknown[] = [id, expectedStatus];
    const sets = keys.map((key) => {
      values.push(key === 'filledPrice' ? toMinor(patch.filledPrice) : patch[key]);
      return `${DRAFT_PATCH_COLUMNS[key]} = $${values.length}`;
    });
    const { rowCount } = await query(
      `UPDATE reply_drafts SET ${[...sets, 'updated_at = now()'].join(', ')}
        WHERE id = $1 AND status = $2`,
      values,
      this.queryClient,
    );
    return rowCount > 0;
  }

  async supersedePendingDrafts(threadId: string, client: PoolClient | Pool | undefined = this.queryClient): Promise<number> {
    const { rowCount } = await query(
      `UPDATE reply_drafts SET status = 'superseded', updated_at = now()
        WHERE thread_id = $1 AND status = 'pending'`,
      [threadId],
      client,
    );
    return rowCount;
  }

  async replacePendingDraft(
    threadId: string,
    expectedNewestMessageId: string,
    draft: Omit<NewReplyDraft, 'threadId'>,
  ): Promise<ReplyDraft | null> {
    const run = async (client: PoolClient): Promise<ReplyDraft | null> => {
      // The thread row lock serialises concurrent runs of one thread.
      await query('SELECT id FROM conversation_threads WHERE id = $1 FOR UPDATE', [threadId], client);
      const { rows } = await query<{ id: string }>(
        'SELECT id FROM conversation_messages WHERE thread_id = $1 ORDER BY sent_at DESC, id LIMIT 1',
        [threadId],
        client,
      );
      if (rows[0]?.id !== expectedNewestMessageId) return null;
      await this.supersedePendingDrafts(threadId, client);
      return this.insertDraft({ ...draft, threadId }, client);
    };
    try {
      // A client passed in belongs to a caller that owns the transaction.
      if (this.client) return await run(this.client);
      if (!this.pool) return await withTransaction(run);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async countReplyRunsToday(workspaceId: string, since: Date): Promise<number> {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM reply_drafts d
         JOIN conversation_threads t ON t.id = d.thread_id
        WHERE t.workspace_id = $1 AND d.created_at >= $2`,
      [workspaceId, since],
      this.queryClient,
    );
    return Number(rows[0].count);
  }

  async purgeExpiredText(before: Date): Promise<number> {
    const { rows } = await query<{ id: string }>(
      `WITH expired AS (
         UPDATE conversation_threads SET text_purged_at = now(), updated_at = now()
          WHERE retention_starts_at < $1 AND text_purged_at IS NULL
          RETURNING id
       ), messages AS (
         UPDATE conversation_messages SET text = NULL, text_hash = NULL
          WHERE thread_id IN (SELECT id FROM expired)
       ), drafts AS (
         UPDATE reply_drafts SET proposed_text = NULL, sent_text = NULL, updated_at = now()
          WHERE thread_id IN (SELECT id FROM expired)
       )
       SELECT id FROM expired`,
      [before],
      this.queryClient,
    );
    return rows.length;
  }

  async awaitingReplyCounts(workspaceId: string): Promise<Record<string, number>> {
    const { rows } = await query<{ product_id: string; count: string }>(
      `SELECT t.product_id, COUNT(DISTINCT t.id)::text AS count
         FROM conversation_threads t
         JOIN reply_drafts d ON d.thread_id = t.id AND d.status = 'pending'
        WHERE t.workspace_id = $1
        GROUP BY t.product_id`,
      [workspaceId],
      this.queryClient,
    );
    return Object.fromEntries(rows.map((row) => [row.product_id, Number(row.count)]));
  }
}
