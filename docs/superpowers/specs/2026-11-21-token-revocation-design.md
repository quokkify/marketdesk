# Token revocation

Item 2 of issue #464. Full design; approaches chosen by the owner on 2026-11-21.

## Why

Access tokens are HS256 JWTs that last 7 days (`JWT_EXPIRATION`, default `7d`) and live in the
browser's `localStorage`. Nothing can invalidate an issued token before it expires: "Sign out" only
clears `localStorage`, so a copied or stolen token keeps working for up to a week, and there is no way
for the user or an operator to cut it off. A deleted user is already refused (the principal guard
loads the user on each protected request), but a user who still exists cannot be protected.

## Current state

- `signToken({ userId, workspaceId })` in `presentation/http/middleware/AuthMiddleware.ts` signs the
  token; `authMiddleware` verifies it (algorithm pinned to HS256) and sets `req.user`.
- Protected routes run `authMiddleware`, the per-user `authLimiter`, `requireWorkspace` and
  `requireCurrentWorkspacePrincipal(users)` (`CurrentPrincipalMiddleware.ts`), which loads the user
  by id: 401 when the user is gone, 403 when the workspace changed.
- `GET /auth/me` runs only `authMiddleware` and a per-user limiter, then loads the user in
  `AuthController.me`.
- Sign-in and registration return `{ token, user }`; there is no logout and no password change
  endpoint.
- The frontend sends the token as a Bearer header (`baseApi.ts`). Any 401 on a request that carried
  the current token dispatches `logout()` and a "session expired" toast. `AuthBootstrap` calls
  `/auth/me` only once per page load, while the user is not hydrated.
- `users` has `id, email, password_hash, workspace_id, created_at`. Every migration file runs on
  every start (no ledger), so schema changes must be idempotent and must not drop anything.

## Goals

- An issued token can be revoked before it expires; revocation takes effect on the next request.
- Four ways to revoke, chosen by the owner:
  1. **Sign out** revokes every token of the user (all devices).
  2. **Operator command** revokes every token of a user by e-mail, for incidents.
  3. **Password change** (new feature) revokes every other token of the user and keeps the current
     device signed in.
  4. **Shorter lifetime**: a token that nobody revoked stops working after 24 hours of inactivity.
- An active user is not signed out by the shorter lifetime (sliding renewal).

## Non-goals

- Signing out a single device while others stay signed in (needs a per-token id and a denylist).
- Refresh tokens or cookies; moving the token out of `localStorage`.
- Password reset by e-mail, admin user management, removing users.
- Changing the per-workspace authorisation rules.

## Anti-goals

- Any request authenticated by a token whose version no longer matches the user's.
- A renewal that extends a revoked token, or that can be triggered without a valid current token.
- Password change that works without the current password, or that is not rate limited.
- A migration that breaks existing tokens in a way the user cannot recover from by signing in again.

## Approaches

Revocation mechanism (decided by issue #464, option b, and accepted by the owner): a per-user token
version stored with the user, embedded in the JWT, compared on each request. Bumping it revokes every
token of that user. Option a (short access tokens plus refresh tokens) was not taken.

Lifetime, three options considered:

| | Approach | Trade-off | Verdict |
| --- | --- | --- | --- |
| A | Default lifetime 24 h, no renewal | Smallest change; an active user must sign in again every day | Rejected |
| B | Default lifetime 24 h plus sliding renewal: a valid token older than 12 h is replaced by a fresh one with the same version | Active users stay signed in, inactive ones drop out after a day; small frontend change | **Chosen by the owner** |
| C | Refresh flow: 15 min access token plus a refresh token in an httpOnly cookie, using `JWT_REFRESH_SECRET` | Shortest life for a stolen access token, but cookies, CSRF and frontend retry logic; revocation by version already makes revocation immediate | Rejected |

## Design

### 1. Token version (backend)

- New idempotent migration `044_user_token_version.sql`:
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;` and the same
  column in `schema.sql`.
- `AuthUserRecord` gains `tokenVersion: number`; `AuthUserRepository` selects it.
- `IAuthUserStore` gains `bumpTokenVersion(userId: string): Promise<number>` (atomic
  `UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version`;
  rejects with a not-found error when no row matches) and
  `updatePassword(userId: string, passwordHash: string): Promise<number>` (sets the hash and bumps the
  version in one statement, returns the new version).
- `JwtPayload` gains `tokenVersion: number` (claim `tv`). `signToken` always includes it.
- Tokens without the claim (issued before this change) are treated as version 0. Every existing user
  has version 0 after the migration, so tokens already in browsers keep working until they expire or
  are revoked; no forced sign-out on deploy.

### 2. Version check on every authenticated request

- `requireCurrentWorkspacePrincipal` also compares the token's version with the stored one; a
  mismatch answers 401 with code `UNAUTHORIZED` and message `'Session has been revoked'`. It stores
  the loaded user on the request (`req.currentUser`) so later middleware does not query again.
- `GET /auth/me` gets the same check: it runs a principal check that verifies existence and version
  (but not workspace membership, which `/me` does not require today).
- Revocation is visible on the very next request: the check reads the database each time; there is
  no cache.
- `/auth/logout` and `/auth/password` use the same check as `/auth/me` (user exists, version
  matches, no workspace rule), so a user whose workspace membership changed can still sign out and
  change the password. All three sit behind the per-IP limiter already mounted on `/auth` and the
  existing per-user `meLimiter`.
- A token without the `tv` claim counts as version 0. Renewal re-signs it like any other valid token
  (24 h lifetime, `tv` set to the stored version); this is the intended sliding behaviour for every
  active session and adds no new way to outlive a revocation.

### 3. Lifetime and sliding renewal

- `JWT_EXPIRATION` default changes from `7d` to `24h` in `env.ts`, `.env.example`,
  `docker-compose.yml` (`${JWT_EXPIRATION:-24h}`) and docs. An explicitly set value is still honoured,
  but a value longer than 24 h logs one warning at boot naming the variable and the recommended
  `24h` (builder's call recorded here: existing `.env` files copied from the old example carry `7d`;
  refusing to boot would break them, silently keeping 7d would hide it). The VPS doc tells operators
  to change it.
- `docker-compose.yml` also passes `JWT_RENEW_AFTER: ${JWT_RENEW_AFTER:-12h}` to the app.
- New setting `JWT_RENEW_AFTER` (default `12h`, same duration syntax as `JWT_EXPIRATION`, validated at
  boot like other env values; must be shorter than `JWT_EXPIRATION`, otherwise boot fails with a
  fix-it message).
- Renewal: after the principal check passes (version matches, user exists), when the token's `iat`
  is older than `JWT_RENEW_AFTER`, the response carries header `X-Renewed-Token` with a freshly signed
  token for the same user, workspace and version. Applies to every route behind the principal check
  and to `/auth/me`. The CORS `exposedHeaders` list gains `X-Renewed-Token`.
- Frontend: `baseQueryWithAuth` reads `X-Renewed-Token` from every successful response; when present
  and the session token is still the one that was sent, it dispatches a new `setToken` action that
  replaces the token in state and `localStorage` without touching the user.

### 4. Sign out

- `POST /auth/logout` behind `authMiddleware` plus the version check: bumps the user's version and
  answers `204`. An already revoked or expired token answers 401 as usual.
- Frontend: the account menu's "Sign out" calls the endpoint, then dispatches `logout()` whatever the
  result (the local session ends even when the server is unreachable), with the existing cleanup.

### 5. Operator command

- `npm run auth:revoke -- <email>` (script `src/backend/persistence/revokeTokens.ts`, run like
  `db:seed`): looks the user up by e-mail (case-insensitive, as sign-in does), bumps the version,
  prints `Revoked all sessions of <email>` and exits 0; unknown e-mail prints an error and exits 1;
  missing argument prints usage and exits 2. It uses the same database configuration as the app.
  Documented in the VPS deployment doc, including the Compose form
  (`docker compose exec app node dist/backend/revokeTokens.js <email>` after a build step bundles it
  like `migrate.js`).

### 6. Password change

- `POST /auth/password` behind `authMiddleware` plus the version check, body
  `{ currentPassword: string, newPassword: string }` validated with zod (`newPassword` at least 8
  characters, as registration requires; must differ from `currentPassword`).
- Wrong current password answers 401 with `'Current password is incorrect'`, and does not bump the
  version. Rate limited by a new per-user limiter: 5 failed attempts per 15 minutes, keyed by user id,
  successful changes not counted (`skipSuccessfulRequests`), same style as the login limiter.
- Success hashes with the existing `BCRYPT_ROUNDS`, calls `updatePassword` (which bumps the version),
  and answers `200 { token }` with a token signed for the new version, so the current device stays
  signed in and every other token is revoked.
- Frontend: a "Change password" card on the Settings page (current password, new password, repeat
  new password; client-side check that the two new values match and are at least 8 characters).
  On success it dispatches `setToken` with the returned token and shows a toast
  `'Password changed. Other devices have been signed out.'`; on 401 for a wrong current password it
  shows the field error and must not sign the user out (the 401 handler in `baseQueryWithAuth`
  excludes this endpoint, as it already excludes `login`).

### 7. Docs

- `.env.example`: `JWT_EXPIRATION=24h`, new `JWT_RENEW_AFTER=12h` with a one-line comment.
- VPS deployment doc: a short "Sessions" section (lifetime, renewal, sign-out signs out every
  device, password change, `auth:revoke` usage).
- `JWT_REFRESH_SECRET` stays generated but unused; `.env.example` says so in a comment instead of
  removing it (removal is a separate decision).

## Left to the builder

- Exact middleware split (one principal-check factory with an option for the workspace rule, or two
  small functions), as long as protected routes and `/auth/me` both get the version check and
  renewal.
- Test layout, following the existing middleware, controller, repository and frontend tests
  (frontend tests have no DOM: pure functions plus `renderToStaticMarkup`; clicks only in Playwright).
- Wording of the Settings card labels other than the toast above.
