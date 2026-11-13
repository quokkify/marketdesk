// Analytics/dashboard routes.

import { Router } from 'express';
import type { AnalyticsController } from '../controllers/AnalyticsController';
import { asyncHandler } from '../middleware/asyncHandler';

export function createAnalyticsRoutes(controller: AnalyticsController): Router {
  const router = Router();
  router.get('/overview', asyncHandler(controller.overview));
  return router;
}
