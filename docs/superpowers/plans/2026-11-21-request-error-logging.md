# Request and Error Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every failed API request and every failed OLX call leaves one readable line in the production log.

**Spec:** `docs/superpowers/specs/2026-11-21-request-error-logging-design.md`

## Global Constraints

- Never log request bodies, query strings, headers, tokens, cookies or credentials.
- Log line message for requests: `HTTP request`; for marketplace failures: `Marketplace API error`.
- Body excerpt cap: 500 characters.

## Review Focus

1. A 4xx from request validation (responds without the error handler) still logs code `VALIDATION_ERROR` and the field paths.
2. A request whose path carries a token-like query (`?code=...` on the OAuth callback) logs the path without the query.
3. A response finished by `res.redirect` (OAuth callback) logs its 302.
4. An OLX timeout (504 from the client) is logged like any other OLX failure.
5. An unauthenticated request logs without user/workspace ids and does not crash.

### Task 1: Request log and 4xx error details

**Files:** create `src/backend/presentation/http/middleware/RequestLoggingMiddleware.ts`; modify `ErrorHandlingMiddleware.ts`, `ValidationMiddleware.ts`, `app.ts`, `config/di/container.ts`.

- `export interface RequestLogger { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void }`
- `export function createRequestLoggingMiddleware(logger: RequestLogger): RequestHandler` — on `res` `finish`, logs `{ method, path, status, durationMs, userId?, workspaceId?, error? }` with level by status; skips paths `/health` and `/ready`.
- `export function recordResponseError(res: Response, error: { code: string; message: string; details?: unknown }): void` — sets `res.locals.responseError`; called by the error handler (every status) and by validation (`details` = field paths only).
- `AppDeps.requestLogger?: RequestLogger`, mounted right after body parsing; container passes `overrides.logger`.
- [ ] Verify on the branch stack (Task 3 script).
- [ ] Commit `feat(logs): log every API request and the error it answered with`.

### Task 2: Marketplace API failures

**Files:** modify `FetchMarketplaceHttpClient.ts` (option `logger?: { warn(obj: object, msg: string): void }`), `container.ts` (pass the logger at all six construction sites).

- On non-ok response or timeout: `logger.warn({ method, url: origin + pathname, status, body: excerpt }, 'Marketplace API error')`, then throw as today.
- [ ] Commit `feat(logs): log failed marketplace API calls with the provider's answer`.

### Task 3: Live verification

- [ ] Script `scripts/check-request-logs.sh` brings nothing up itself; against a running stack it sends: `POST /api/auth/login` with `{}` (400), `GET /api/products` unauthenticated (401), register + `GET /api/products` (200), `GET /api/marketplaces/olx/oauth/callback?code=secret-code` and asserts in `docker logs marketdesk-app`: one `HTTP request` line each with the right status, `VALIDATION_ERROR` on the 400, no `secret-code`, no `Bearer`, no password value.
- [ ] Full Jest suite green; q4j `apiTest` green.
- [ ] Commit `test: check the request log against a running stack`.
