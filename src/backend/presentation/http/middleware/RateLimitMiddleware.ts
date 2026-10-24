// Rate limiting per ARCHITECTURE.md §18:
//   - public routes (auth):        100 req/min per IP
//   - GET /auth/me:                100 req/15 min keyed by userId (fallback IP)
//   - authenticated routes:      1000 req/min keyed by workspaceId (fallback IP)
//   - sensitive price operations:  10 req/min keyed by workspaceId (fallback IP)
// All limiters emit the §18 error envelope (429, RATE_LIMITED) on rejection.

import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';

const WINDOW_MS = 60 * 1000;
const ME_WINDOW_MS = 15 * 60 * 1000;

function keyByWorkspace(req: Request): string {
  return req.user?.workspaceId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

function keyByUser(req: Request): string {
  return req.user?.userId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

function rejection(_req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
  });
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
// key would make everyone behind one NAT or reverse proxy share, and exhaust, a single allowance.
export function meRateLimiter(limit = 100): RateLimitRequestHandler {
  return build(limit, keyByUser, ME_WINDOW_MS);
}

export function sensitiveRateLimiter(): RateLimitRequestHandler {
  return build(10, keyByWorkspace);
}

export function uploadRateLimiter(limit = 30): RateLimitRequestHandler {
  return build(limit, keyByWorkspace);
}
