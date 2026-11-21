// Thin HTTP adapter for the buyer conversations of a product. The product is loaded for the
// caller's workspace first, so a foreign or unknown product id answers 404.

import type { Request, Response, NextFunction } from 'express';
import type { IConversationRepository } from '../../../domain/repositories/interfaces/IConversationRepository';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { isUuid } from '../../../../shared/validation/identifiers';
import { presentConversationThread } from '../../../application/dto/presenters';
import { ok } from '../formatters/ResponseFormatter';

// Newest messages shown per thread.
const THREAD_VIEW_MESSAGES = 50;

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class ConversationController {
  constructor(
    private readonly products: Pick<IProductRepository, 'findByIdForWorkspace'>,
    private readonly conversations: Pick<
      IConversationRepository,
      'listThreadsForProduct' | 'recentMessages' | 'latestDraft'
    >,
  ) {}

  listForProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    const product = isUuid(productId)
      ? await this.products.findByIdForWorkspace(productId, workspaceId)
      : null;
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    const threads = await this.conversations.listThreadsForProduct(productId, workspaceId);
    const views = await Promise.all(
      threads.map(async (thread) => {
        const [newestFirst, draft] = await Promise.all([
          this.conversations.recentMessages(thread.id, THREAD_VIEW_MESSAGES),
          this.conversations.latestDraft(thread.id),
        ]);
        return presentConversationThread(thread, [...newestFirst].reverse(), draft);
      }),
    );
    ok(res, { threads: views });
  };
}
