// Buyer conversation routes. Auth and the authenticated rate limiter are applied where the API
// router mounts this; aiLimiter guards the route that queues an AI reply run.

import { Router, type RequestHandler } from 'express';
import type { ConversationController } from '../controllers/ConversationController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { sandboxBuyerMessageSchema, sendReplySchema } from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createConversationRoutes(
  controller: ConversationController,
  aiLimiter: RequestHandler = passthrough
): Router {
  const router = Router();
  router.get('/awaiting', asyncHandler(controller.awaiting));
  router.post(
    '/:threadId/drafts/:draftId/send',
    validateBody(sendReplySchema),
    asyncHandler(controller.send)
  );
  router.post('/:threadId/drafts/:draftId/dismiss', asyncHandler(controller.dismiss));
  router.post('/:threadId/regenerate', aiLimiter, asyncHandler(controller.regenerate));
  return router;
}

// Mounted only while OLX runs in stub mode, so the route does not exist in production.
export function createSandboxOlxRoutes(controller: ConversationController): Router {
  const router = Router();
  router.post(
    '/threads/:externalThreadId/buyer-message',
    validateBody(sandboxBuyerMessageSchema),
    asyncHandler(controller.appendSandboxBuyerMessage)
  );
  return router;
}
