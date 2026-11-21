// Listing routes. Price-affecting operations (update/publish/relist) are guarded by
// the sensitive rate limiter (§18: 10/min) when one is supplied; routes that call the AI
// provider by the AI rate limiter (see aiRateLimiter).

import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { ListingController } from '../controllers/ListingController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import {
  delistListingToDraftSchema,
  marketplaceCategorySchema,
  publishListingSchema,
  reactivateListingSchema,
  revivalProposalSchema,
  reviveListingSchema,
} from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();
const categoryWriteLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || 'unknown'),
});
const categorySearchLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip || 'unknown'),
});

export function createListingRoutes(
  controller: ListingController,
  sensitiveLimiter: RequestHandler = passthrough,
  aiLimiter: RequestHandler = passthrough,
): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.get));
  router.get('/:id/price-history', asyncHandler(controller.priceHistory));
  router.get('/:id/marketplace-categories', categorySearchLimiter, asyncHandler(controller.searchMarketplaceCategories));
  router.patch('/:id', sensitiveLimiter, asyncHandler(controller.update));
  router.put(
    '/:id/marketplace-category',
    categoryWriteLimiter,
    sensitiveLimiter,
    validateBody(marketplaceCategorySchema),
    asyncHandler(controller.setMarketplaceCategory),
  );
  router.post('/:id/publish-preview', sensitiveLimiter, asyncHandler(controller.publishPreview));
  router.post(
    '/:id/delist-to-draft',
    sensitiveLimiter,
    validateBody(delistListingToDraftSchema),
    asyncHandler(controller.delistToDraft),
  );
  router.post(
    '/:id/publish',
    sensitiveLimiter,
    validateBody(publishListingSchema),
    asyncHandler(controller.publish),
  );
  router.post(
    '/:id/reactivate',
    sensitiveLimiter,
    validateBody(reactivateListingSchema),
    asyncHandler(controller.reactivate),
  );
  router.post(
    '/:id/revival-proposal',
    aiLimiter,
    validateBody(revivalProposalSchema),
    asyncHandler(controller.revivalProposal),
  );
  // The workspace's listing is looked up before the body is validated, so an unknown or foreign
  // listing reads as 404 whatever the body.
  router.post(
    '/:id/revive',
    sensitiveLimiter,
    asyncHandler(controller.requireListing),
    validateBody(reviveListingSchema),
    asyncHandler(controller.revive),
  );
  router.post(
    '/:id/relist',
    sensitiveLimiter,
    validateBody(publishListingSchema),
    asyncHandler(controller.relist),
  );
  return router;
}
