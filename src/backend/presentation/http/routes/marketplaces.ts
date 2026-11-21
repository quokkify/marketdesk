// Marketplace routes.

import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { MarketplaceController } from '../controllers/MarketplaceController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import { setOlxPublicationQuotaSchema, updateMarketplaceSchema } from '../validation/schemas';

const categorySearchLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || 'unknown'),
});

export function createMarketplaceRoutes(controller: MarketplaceController): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.get));
  router.get('/:id/categories', categorySearchLimiter, asyncHandler(controller.searchCategories));
  router.get('/:id/quotas', asyncHandler(controller.listQuotas));
  router.put(
    '/:id/quotas',
    validateBody(setOlxPublicationQuotaSchema),
    asyncHandler(controller.setQuota),
  );
  router.post('/:id/sync', asyncHandler(controller.sync));
  router.post('/:id/connect', asyncHandler(controller.connect));
  router.get('/:id/app-credentials', asyncHandler(controller.getAppCredentials));
  router.put('/:id/app-credentials', asyncHandler(controller.saveAppCredentials));
  router.delete('/:id/app-credentials', asyncHandler(controller.removeAppCredentials));
  router.get('/:id/check', asyncHandler(controller.check));
  router.patch('/:id', validateBody(updateMarketplaceSchema), asyncHandler(controller.update));
  return router;
}
