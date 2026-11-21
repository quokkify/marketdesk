// Auth routes. login/register are public; the per-IP public limiter is mounted on the whole
// /auth prefix by routes/index.ts, in front of this router, so it also caps unauthenticated
// hits on the /me token check. /me is then protected by the JWT auth middleware and rate
// limited per user. Failed logins are also limited per account (loginLimiter), and register
// answers 403 when the instance has registration switched off.

import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authMiddleware } from '../middleware/AuthMiddleware';
import { validateBody } from '../middleware/ValidationMiddleware';
import { loginSchema, registerSchema } from '../validation/schemas';
import { fail } from '../formatters/ResponseFormatter';
import { ERROR_CODES } from '../../../../shared/constants';

const passthrough: RequestHandler = (_req, _res, next) => next();

const registrationDisabled: RequestHandler = (_req, res) => {
  fail(res, undefined, 403, {
    code: ERROR_CODES.FORBIDDEN,
    message: 'Registration is disabled on this instance. Ask the administrator for an account.',
  });
};

export interface AuthRouteOptions {
  loginLimiter?: RequestHandler;
  registrationEnabled?: boolean;
}

export function createAuthRoutes(
  controller: AuthController,
  meLimiter: RequestHandler = passthrough,
  { loginLimiter = passthrough, registrationEnabled = true }: AuthRouteOptions = {}
): Router {
  const router = Router();

  // After validation: the per-account limiter keys by the e-mail in the body.
  router.post('/login', validateBody(loginSchema), loginLimiter, asyncHandler(controller.login));
  if (registrationEnabled) {
    router.post('/register', validateBody(registerSchema), asyncHandler(controller.register));
  } else {
    router.post('/register', registrationDisabled);
  }
  // The per-user limiter runs after authMiddleware so it can key by user; a bad token never
  // reaches it and spends only the per-IP allowance of the /auth mount.
  router.get('/me', authMiddleware, meLimiter, asyncHandler(controller.me));
  return router;
}
