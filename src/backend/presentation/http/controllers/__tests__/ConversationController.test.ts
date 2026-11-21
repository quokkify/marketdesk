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

describe('ConversationController reply actions', () => {
  const THREAD = '2f1c5b7a-9d3e-4c8f-a1b2-3c4d5e6f7a80';
  const DRAFT = '8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f60';
  const thread = {
    id: THREAD, workspaceId: 'ws-1', listingId: 'l1', productId: PRODUCT, externalThreadId: 'x', externalBuyerId: null,
    status: 'open' as const, suspiciousReasons: [], lastExternalMessageId: null, retentionStartsAt: null,
    textPurgedAt: null, createdAt: at, updatedAt: at,
  };

  function actions(options: { sandbox?: boolean } = {}) {
    const products = { findByIdForWorkspace: jest.fn(async (): Promise<Product | null> => null) };
    const conversations = {
      listThreadsForProduct: jest.fn(async () => []),
      findThreadForWorkspace: jest.fn(async () => thread),
      recentMessages: jest.fn(async () => []),
      latestDraft: jest.fn(async () => null),
      awaitingReplyCounts: jest.fn(async () => ({ [PRODUCT]: 2 })),
    };
    const replies = {
      send: jest.fn(),
      dismiss: jest.fn(),
      regenerate: jest.fn(),
    };
    const sandboxBuyerMessage = jest.fn();
    const controller = new ConversationController(products, conversations, {
      replies, sandboxBuyerMessage: options.sandbox ? sandboxBuyerMessage : undefined,
    });
    const status = jest.fn();
    const json = jest.fn();
    status.mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    const req = (params: Record<string, string>, body: unknown = {}) =>
      ({ params, body, user: { workspaceId: 'ws-1', userId: 'u1' } }) as unknown as Request;
    return { controller, conversations, replies, sandboxBuyerMessage, status, json, res, next, req };
  }

  it('answers a sent draft with the refreshed thread view', async () => {
    const { controller, replies, status, json, res, next, req } = actions();
    replies.send.mockResolvedValue({ kind: 'sent' });
    await controller.send(req({ threadId: THREAD, draftId: DRAFT }, { text: 'Yes' }), res, next);
    expect(replies.send).toHaveBeenCalledWith({
      workspaceId: 'ws-1', threadId: THREAD, draftId: DRAFT, text: 'Yes', actorId: 'u1',
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].data.thread.id).toBe(THREAD);
  });

  it.each([
    [{ kind: 'draft_rule', rule: 'link' }, 422, { code: 'draft_rule', details: { rule: 'link' } }],
    [{ kind: 'rejected', code: 'superseded' }, 409, { code: 'superseded' }],
    [{ kind: 'rejected', code: 'already_sending' }, 409, { code: 'already_sending' }],
    [{ kind: 'rejected', code: 'unclear_send' }, 409, { code: 'unclear_send' }],
  ])('maps send outcome %p to %p', async (outcome, expectedStatus, error) => {
    const { controller, replies, status, json, res, next, req } = actions();
    replies.send.mockResolvedValue(outcome);
    await controller.send(req({ threadId: THREAD, draftId: DRAFT }, { text: 'Yes' }), res, next);
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json.mock.calls[0][0]).toMatchObject({ success: false, error });
  });

  it('answers not found for ids that are not uuids without calling the service', async () => {
    const { controller, replies, res, next, req } = actions();
    await controller.send(req({ threadId: 'nope', draftId: DRAFT }, { text: 'Yes' }), res, next);
    await controller.dismiss(req({ threadId: THREAD, draftId: '..' }), res, next);
    await controller.regenerate(req({ threadId: 'x' }), res, next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(next.mock.calls.every(([error]) => error instanceof NotFoundError)).toBe(true);
    expect(replies.send).not.toHaveBeenCalled();
    expect(replies.dismiss).not.toHaveBeenCalled();
    expect(replies.regenerate).not.toHaveBeenCalled();
  });

  it('dismisses with 200 and answers not_pending with 409', async () => {
    const { controller, replies, status, res, next, req } = actions();
    replies.dismiss.mockResolvedValueOnce({ kind: 'dismissed' }).mockResolvedValueOnce({ kind: 'rejected', code: 'not_pending' });
    await controller.dismiss(req({ threadId: THREAD, draftId: DRAFT }), res, next);
    await controller.dismiss(req({ threadId: THREAD, draftId: DRAFT }), res, next);
    expect(status.mock.calls).toEqual([[200], [409]]);
  });

  it('accepts a regeneration with 202 and answers the daily cap with 429', async () => {
    const { controller, replies, status, json, res, next, req } = actions();
    replies.regenerate.mockResolvedValueOnce({ kind: 'queued' }).mockResolvedValueOnce({ kind: 'rejected', code: 'daily_cap' });
    await controller.regenerate(req({ threadId: THREAD }), res, next);
    await controller.regenerate(req({ threadId: THREAD }), res, next);
    expect(status.mock.calls).toEqual([[202], [429]]);
    expect(json.mock.calls[1][0].error.code).toBe('daily_cap');
  });

  it('counts the threads awaiting an answer per product', async () => {
    const { controller, conversations, json, res, req } = actions();
    await controller.awaiting(req({}), res);
    expect(conversations.awaitingReplyCounts).toHaveBeenCalledWith('ws-1');
    expect(json.mock.calls[0][0].data).toEqual({ byProductId: { [PRODUCT]: 2 } });
  });

  it('appends a sandbox buyer message for the workspace and answers 404 for a thread it does not own', async () => {
    const { controller, sandboxBuyerMessage, status, res, next, req } = actions({ sandbox: true });
    sandboxBuyerMessage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await controller.appendSandboxBuyerMessage(req({ externalThreadId: 'sbx-1-buyer' }, { text: 'Hello?' }), res, next);
    expect(sandboxBuyerMessage).toHaveBeenCalledWith('ws-1', 'sbx-1-buyer', 'Hello?');
    expect(status).toHaveBeenCalledWith(201);
    await controller.appendSandboxBuyerMessage(req({ externalThreadId: 'sbx-2-buyer' }, { text: 'Hello?' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
  });
});
