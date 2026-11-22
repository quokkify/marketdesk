// Hermes (autonomous agent) routes.

import { Router, type RequestHandler } from 'express';
import type { HermesController } from '../controllers/HermesController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import {
  approveEventSchema,
  approveCategoryCorrectionOperationSchema,
  executeCategoryCorrectionOperationSchema,
  dismissEventSchema,
  runProductHermesSchema,
} from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

// aiLimiter guards the route that runs the AI agent (see aiRateLimiter).
export function createHermesRoutes(
  controller: HermesController,
  aiLimiter: RequestHandler = passthrough
): Router {
  const router = Router();
  router.get('/status', asyncHandler(controller.status));
  router.get('/usage', asyncHandler(controller.usage));
  router.get('/limits', asyncHandler(controller.limits));
  router.get('/events', asyncHandler(controller.list));
  router.get('/events/pending-counts', asyncHandler(controller.pendingCounts));
  router.get('/events/:id', asyncHandler(controller.get));
  router.get(
    '/events/:id/category-correction-operations',
    asyncHandler(controller.listCategoryCorrectionOperations)
  );
  router.post(
    '/category-correction-operations/:operationId/approve',
    validateBody(approveCategoryCorrectionOperationSchema),
    asyncHandler(controller.approveCategoryCorrectionOperation)
  );
  router.post(
    '/category-correction-operations/:operationId/execute',
    validateBody(executeCategoryCorrectionOperationSchema),
    asyncHandler(controller.executeCategoryCorrectionOperation)
  );
  router.post(
    '/events/:id/approve',
    validateBody(approveEventSchema),
    asyncHandler(controller.approve)
  );
  router.post(
    '/events/:id/dismiss',
    validateBody(dismissEventSchema),
    asyncHandler(controller.dismiss)
  );
  router.post(
    '/products/:productId/run',
    aiLimiter,
    validateBody(runProductHermesSchema),
    asyncHandler(controller.runForProduct)
  );
  router.get('/products/:productId/verdict', asyncHandler(controller.verdict));
  return router;
}
