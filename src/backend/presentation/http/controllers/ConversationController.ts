// Thin HTTP adapter for buyer conversations. Every lookup is scoped to the caller's workspace, so a
// foreign or unknown product, thread or draft answers 404.

import type { Request, Response, NextFunction } from 'express';
import type { ConversationThread } from '../../../domain/conversations/types';
import type { IConversationRepository } from '../../../domain/repositories/interfaces/IConversationRepository';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import { NotFoundError, ServiceUnavailableError } from '../../../domain/shared/DomainError';
import { isUuid } from '../../../../shared/validation/identifiers';
import { presentConversationThread } from '../../../application/dto/presenters';
import type { ReplyConflictCode, ReplySendService } from '../../../application/services/ReplySendService';
import { fail, ok } from '../formatters/ResponseFormatter';

// Newest messages shown per thread.
const THREAD_VIEW_MESSAGES = 50;

const CONFLICT_MESSAGES: Record<ReplyConflictCode, string> = {
  superseded: 'The buyer wrote again; review the new message first',
  already_sending: 'This reply is already being sent',
  not_pending: 'This draft is no longer waiting to be sent',
  unclear_send: 'The reply may or may not have been sent; check the conversation on OLX',
  daily_cap: 'The daily AI reply limit is reached',
  nothing_to_answer: 'The newest message in this conversation is not from the buyer',
  suspicious: 'This conversation is marked suspicious',
};

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function conflict(res: Response, code: ReplyConflictCode): void {
  fail(res, null, code === 'daily_cap' ? 429 : 409, { code, message: CONFLICT_MESSAGES[code] });
}

export interface ConversationActions {
  replies?: Pick<ReplySendService, 'send' | 'dismiss' | 'regenerate'>;
  // Present only while OLX runs in stub mode.
  sandboxBuyerMessage?: (externalThreadId: string, text: string) => void;
}

export class ConversationController {
  constructor(
    private readonly products: Pick<IProductRepository, 'findByIdForWorkspace'>,
    private readonly conversations: Pick<
      IConversationRepository,
      'listThreadsForProduct' | 'recentMessages' | 'latestDraft'
    > & Partial<Pick<IConversationRepository, 'findThreadForWorkspace' | 'awaitingReplyCounts'>>,
    private readonly actions: ConversationActions = {},
  ) {}

  get sandboxEnabled(): boolean {
    return this.actions.sandboxBuyerMessage !== undefined;
  }

  listForProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    const product = isUuid(productId)
      ? await this.products.findByIdForWorkspace(productId, workspaceId)
      : null;
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    const threads = await this.conversations.listThreadsForProduct(productId, workspaceId);
    ok(res, { threads: await Promise.all(threads.map((thread) => this.threadView(thread))) });
  };

  send = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ids = this.draftIds(req);
    if (!ids) return next(new NotFoundError('Reply draft not found'));
    const workspaceId = req.user!.workspaceId!;
    const outcome = await this.replies().send({
      workspaceId, ...ids, text: (req.body as { text: string }).text, actorId: req.user!.userId,
    });
    if (outcome.kind === 'draft_rule') {
      fail(res, null, 422, {
        code: 'draft_rule', message: 'The reply breaks a safety rule', details: { rule: outcome.rule },
      });
      return;
    }
    if (outcome.kind === 'rejected') return conflict(res, outcome.code);
    ok(res, { thread: await this.threadViewById(ids.threadId, workspaceId) });
  };

  dismiss = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ids = this.draftIds(req);
    if (!ids) return next(new NotFoundError('Reply draft not found'));
    const workspaceId = req.user!.workspaceId!;
    const outcome = await this.replies().dismiss({ workspaceId, ...ids });
    if (outcome.kind === 'rejected') return conflict(res, outcome.code);
    ok(res, { thread: await this.threadViewById(ids.threadId, workspaceId) });
  };

  regenerate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const threadId = routeParam(req.params.threadId);
    if (!isUuid(threadId)) return next(new NotFoundError(`Conversation thread not found: ${threadId}`));
    const outcome = await this.replies().regenerate({ workspaceId: req.user!.workspaceId!, threadId });
    if (outcome.kind === 'rejected') return conflict(res, outcome.code);
    ok(res, { queued: true }, 202);
  };

  awaiting = async (req: Request, res: Response): Promise<void> => {
    if (!this.conversations.awaitingReplyCounts) throw new ServiceUnavailableError('Conversations are not configured');
    ok(res, { byProductId: await this.conversations.awaitingReplyCounts(req.user!.workspaceId!) });
  };

  // Simulates a buyer writing in the stub OLX; the next sync or send-time read picks it up.
  appendSandboxBuyerMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const append = this.actions.sandboxBuyerMessage;
    const externalThreadId = routeParam(req.params.externalThreadId);
    if (!append) return next(new NotFoundError('Route not found'));
    try {
      append(externalThreadId, (req.body as { text: string }).text);
    } catch {
      return next(new NotFoundError(`Sandbox thread not found: ${externalThreadId}`));
    }
    ok(res, { appended: true }, 201);
  };

  private replies(): NonNullable<ConversationActions['replies']> {
    if (!this.actions.replies) throw new ServiceUnavailableError('Reply sending is not configured');
    return this.actions.replies;
  }

  private draftIds(req: Request): { threadId: string; draftId: string } | null {
    const threadId = routeParam(req.params.threadId);
    const draftId = routeParam(req.params.draftId);
    return isUuid(threadId) && isUuid(draftId) ? { threadId, draftId } : null;
  }

  private async threadViewById(threadId: string, workspaceId: string) {
    const thread = await this.conversations.findThreadForWorkspace?.(threadId, workspaceId);
    if (!thread) throw new NotFoundError(`Conversation thread not found: ${threadId}`);
    return this.threadView(thread);
  }

  private async threadView(thread: ConversationThread) {
    const [newestFirst, draft] = await Promise.all([
      this.conversations.recentMessages(thread.id, THREAD_VIEW_MESSAGES),
      this.conversations.latestDraft(thread.id),
    ]);
    return presentConversationThread(thread, [...newestFirst].reverse(), draft);
  }
}
