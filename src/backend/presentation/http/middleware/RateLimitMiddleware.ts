// Rate limiting per ARCHITECTURE.md §18:
//   - public routes (the /auth prefix incl. the /auth/me token check, OAuth callback,
//     application-info):          100 req/min per IP
//   - GET /auth/me, after auth:    100 req/15 min keyed by userId (fallback IP)
//   - authenticated routes:      1000 req/min keyed by workspaceId (fallback IP)
//   - sensitive price operations:  10 req/min keyed by workspaceId (fallback IP)
//   - AI-invoking routes:          AI_RATE_LIMIT_PER_MINUTE (default 10) req/min keyed by
//                                  workspaceId (fallback IP), one allowance for all of them
//   - failed password changes:     5 per 15 min keyed by userId, successes not counted
//   - failed logins:               10 per 15 min keyed by normalised e-mail, any IP
// All limiters emit the §18 error envelope (429, RATE_LIMITED) on rejection.

import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { recordResponseError } from './RequestLoggingMiddleware';

const WINDOW_MS = 60 * 1000;
const ME_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_CHANGE_LIMIT = 5;
const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000;

function keyByWorkspace(req: Request): string {
  return req.user?.workspaceId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

function keyByUser(req: Request): string {
  return req.user?.userId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

// A digest keeps every key the same small size whatever the body holds, so stored keys cannot be
// used to fill memory, and the store holds no addresses.
export function loginFailureKey(req: Request): string {
  const email: unknown = req.body?.email;
  if (typeof email !== 'string') return ipKeyGenerator(req.ip ?? 'unknown');
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `login:${digest}`;
}

function rejection(_req: Request, res: Response): void {
  const error = { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' };
  recordResponseError(res, error);
  res.status(429).json({ success: false, error });
}

function build(
  limit: number,
  keyGenerator?: (req: Request) => string,
  windowMs = WINDOW_MS
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: rejection,
  });
}

export function publicRateLimiter(): RateLimitRequestHandler {
  // Default keyGenerator (IP-based, IPv6-safe) is applied when none is supplied.
  return build(100);
}

export function authenticatedRateLimiter(): RateLimitRequestHandler {
  return build(1000, keyByWorkspace);
}

// Mount it after authMiddleware so req.user is set and the allowance belongs to the user. An IP
// key would make everyone behind one NAT or reverse proxy share, and exhaust, a single 15-minute
// allowance. The per-IP public limiter on the /auth prefix in front of it is only a flood guard
// (100/min, see routes/index.ts).
export function meRateLimiter(limit = 100): RateLimitRequestHandler {
  return build(limit, keyByUser, ME_WINDOW_MS);
}

export function sensitiveRateLimiter(): RateLimitRequestHandler {
  return build(10, keyByWorkspace);
}

export function uploadRateLimiter(limit = 30): RateLimitRequestHandler {
  return build(limit, keyByWorkspace);
}

// One allowance for every route that calls the AI provider, so a workspace cannot multiply it by
// spreading calls over drafts, rechecks, improvements and Hermes runs.
export function aiRateLimiter(limit: number): RateLimitRequestHandler {
  return build(limit, keyByWorkspace);
}

// Per account, not per IP: an attacker spreading attempts over many addresses still exhausts the
// account's allowance, and the limit does not depend on the proxy restoring the client IP. Only
// failures count, so a user who signs in normally never spends it. Mount it after body
// validation, because the key is the e-mail in the body. Rate-limit headers are off so known and
// unknown e-mails get byte-identical answers; the window is fixed, so a locked account opens again
// when it ends.
export function loginFailureRateLimiter(
  limit = LOGIN_FAILURE_LIMIT,
  windowMs = LOGIN_FAILURE_WINDOW_MS
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginFailureKey,
    handler: rejection,
  });
}

// Mount it after authMiddleware: the allowance belongs to the user, and only failed attempts
// (wrong current password) count.
export function passwordChangeRateLimiter(
  limit = PASSWORD_CHANGE_LIMIT,
  windowMs = PASSWORD_CHANGE_WINDOW_MS
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: keyByUser,
    handler: rejection,
  });
}
