// Auth routes. login/register are public (public rate limiter when supplied); /me is
// protected by the JWT auth middleware and then rate limited per user.

import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { validateBody } from '../middleware/ValidationMiddleware';
import { loginSchema, registerSchema } from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createAuthRoutes(
  controller: AuthController,
  publicLimiter: RequestHandler = passthrough,
  meLimiter: RequestHandler = passthrough,
): Router {
  const router = Router();
  const limiter = publicLimiter ?? passthrough;

  router.post('/login', limiter, validateBody(loginSchema), asyncHandler(controller.login));
  router.post(
    '/register',
    limiter,
    validateBody(registerSchema),
    asyncHandler(controller.register),
  );
  // The limiter runs after authMiddleware so it can key by user; a bad token never reaches it.
  router.get('/me', authMiddleware, meLimiter, asyncHandler(controller.me));
  return router;
}
