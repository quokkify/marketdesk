// Auth routes. login/register are public; the per-IP public limiter is mounted on the whole
// /auth prefix by routes/index.ts, in front of this router, so it also caps unauthenticated
// hits on the /me token check. /me is then protected by the JWT auth middleware and rate
// limited per user.

import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { validateBody } from '../middleware/ValidationMiddleware';
import { loginSchema, registerSchema } from '../validation/schemas';

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createAuthRoutes(
  controller: AuthController,
  meLimiter: RequestHandler = passthrough
): Router {
  const router = Router();

  router.post('/login', validateBody(loginSchema), asyncHandler(controller.login));
  router.post('/register', validateBody(registerSchema), asyncHandler(controller.register));
  // The per-user limiter runs after authMiddleware so it can key by user; a bad token never
  // reaches it and spends only the per-IP allowance of the /auth mount.
  router.get('/me', authMiddleware, meLimiter, asyncHandler(controller.me));
  return router;
}
