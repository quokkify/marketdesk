import type { NextFunction, Request, Response } from 'express';
import { ConversationController } from '../ConversationController';
import { NotFoundError } from '../../../../domain/shared/DomainError';
import type { Product } from '../../../../domain/entities/Product';

const PRODUCT = '7d0c4f3e-2b8a-4d51-9c1e-0a6f3b2d5e71';
const at = new Date('2026-11-21T10:00:00.000Z');

function setup(product: Product | null) {
  const products = { findByIdForWorkspace: jest.fn(async (): Promise<Product | null> => product) };
  const conversations = {
    listThreadsForProduct: jest.fn(async () => [{
      id: 't1', workspaceId: 'ws-1', listingId: 'l1', productId: PRODUCT, externalThreadId: 'x', externalBuyerId: null,
      status: 'open' as const, suspiciousReasons: [], lastExternalMessageId: null, retentionStartsAt: null,
      textPurgedAt: null, createdAt: at, updatedAt: at,
    }]),
    // Newest first, as the repository returns them.
    recentMessages: jest.fn(async () => [
      { id: 'm2', threadId: 't1', externalMessageId: 'x2', direction: 'seller' as const, text: 'b', textHash: null, sentAt: at },
      { id: 'm1', threadId: 't1', externalMessageId: 'x1', direction: 'buyer' as const, text: 'a', textHash: 'h', sentAt: at },
    ]),
    latestDraft: jest.fn(async () => null),
  };
  const status = jest.fn();
  const json = jest.fn();
  status.mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction & jest.Mock;
  const controller = new ConversationController(products, conversations);
  const req = (id: string) => ({ params: { id }, user: { workspaceId: 'ws-1' } }) as unknown as Request;
  return { controller, products, conversations, status, json, res, next, req };
}

describe('ConversationController.listForProduct', () => {
  it('returns the workspace product threads with messages oldest first', async () => {
    const { controller, products, conversations, json, res, next, req } = setup({ id: PRODUCT } as Product);

    await controller.listForProduct(req(PRODUCT), res, next);

    expect(products.findByIdForWorkspace).toHaveBeenCalledWith(PRODUCT, 'ws-1');
    expect(conversations.listThreadsForProduct).toHaveBeenCalledWith(PRODUCT, 'ws-1');
    const body = json.mock.calls[0][0];
    expect(body.data.threads).toHaveLength(1);
    expect(body.data.threads[0].messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
    expect(body.data.threads[0].draft).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });

  it('answers not found for a product of another workspace', async () => {
    const { controller, conversations, res, next, req } = setup(null);
    await controller.listForProduct(req(PRODUCT), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(conversations.listThreadsForProduct).not.toHaveBeenCalled();
  });

  it('answers not found for an id that is not a uuid without querying', async () => {
    const { controller, products, res, next, req } = setup({ id: PRODUCT } as Product);
    await controller.listForProduct(req('not-a-uuid'), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    expect(products.findByIdForWorkspace).not.toHaveBeenCalled();
  });
});
