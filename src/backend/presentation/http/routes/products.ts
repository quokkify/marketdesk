// Product routes (§18 REST conventions). Auth is applied by the API router when this
// is mounted; validation is applied on writes.

import { Router, type RequestHandler } from 'express';
import type { ProductController } from '../controllers/ProductController';
import type { ConversationController } from '../controllers/ConversationController';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/ValidationMiddleware';
import {
  createListingSchema,
  createProductSchema,
  productAIDraftSchema,
  productRecheckSchema,
  productImprovementSchema,
  priceResearchSchema,
  updateProductSchema,
} from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

// aiLimiter guards the routes that call the AI provider (see aiRateLimiter).
export function createProductRoutes(
  controller: ProductController,
  aiLimiter: RequestHandler = passthrough,
  conversations?: ConversationController
): Router {
  const router = Router();
  router.get('/', asyncHandler(controller.list));
  router.post('/', validateBody(createProductSchema), asyncHandler(controller.create));
  router.post('/ai-draft', aiLimiter, validateBody(productAIDraftSchema), asyncHandler(controller.generateAIDraft));
  router.get('/:id', asyncHandler(controller.get));
  router.patch('/:id', validateBody(updateProductSchema), asyncHandler(controller.update));
  router.post('/:id/recheck', aiLimiter, validateBody(productRecheckSchema), asyncHandler(controller.recheck));
  router.post('/:id/improvements', aiLimiter, validateBody(productImprovementSchema), asyncHandler(controller.proposeImprovements));
  router.delete('/:id', asyncHandler(controller.remove));
  router.get('/:id/price-research', asyncHandler(controller.getPriceResearch));
  router.put('/:id/price-research', validateBody(priceResearchSchema), asyncHandler(controller.putPriceResearch));
  router.post('/:id/price-research/search', aiLimiter, asyncHandler(controller.searchComparables));
  router.get('/:id/listings', asyncHandler(controller.getListings));
  router.post('/:id/listings', validateBody(createListingSchema), asyncHandler(controller.createListing));
  if (conversations) router.get('/:id/conversations', asyncHandler(conversations.listForProduct));
  return router;
}
