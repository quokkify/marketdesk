# Token Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issued JWTs can be revoked (sign-out, operator command, password change) and expire after 24 h of inactivity with sliding renewal.

**Architecture:** A `token_version` column on `users` is embedded in the JWT as claim `tv` and compared with the stored value by the principal middleware on every authenticated request; bumping it revokes all of a user's tokens. The same middleware renews tokens older than `JWT_RENEW_AFTER` through an `X-Renewed-Token` response header that the frontend base query picks up.

**Tech Stack:** TypeScript, Express, PostgreSQL (`pg`), `jsonwebtoken`, `bcrypt`, `express-rate-limit`, zod, React + Redux Toolkit Query, Jest.

**Spec:** `docs/superpowers/specs/2026-11-21-token-revocation-design.md`

## Global Constraints

- Migrations replay on every start with no ledger: schema changes are idempotent (`ADD COLUMN IF NOT EXISTS`), nothing is dropped.
- Claim name `tv`; a token without `tv` counts as version 0; existing users get version 0.
- Revoked token answer: 401, code `UNAUTHORIZED`, message `'Session has been revoked'`.
- `JWT_EXPIRATION` default `24h` (also `docker-compose.yml` `${JWT_EXPIRATION:-24h}`); `JWT_RENEW_AFTER` default `12h` (`${JWT_RENEW_AFTER:-12h}`), must be shorter than `JWT_EXPIRATION`; an explicit `JWT_EXPIRATION` longer than 24 h is honoured with one boot warning.
- Renewal header name `X-Renewed-Token`; added to CORS `exposedHeaders`.
- Durations accept `<integer><unit>` with unit `s`, `m`, `h` or `d` (e.g. `24h`, `7d`); anything else is a boot problem naming the variable. (Narrower than `jsonwebtoken`'s `ms` syntax; no new dependency.)
- Password rules: `newPassword` at least 8 characters, differs from `currentPassword`; wrong current password answers 401 `'Current password is incorrect'` without a version bump; limiter 5 failed attempts per 15 minutes per user, `skipSuccessfulRequests: true`.
- Toast after password change: `'Password changed. Other devices have been signed out.'`
- `/auth/logout` answers `204`; `/auth/me`, `/auth/logout`, `/auth/password` check existence and version but not workspace membership.
- Operator command `npm run auth:revoke -- <email>`: prints `Revoked all sessions of <email>`, exit 0; unknown e-mail exit 1; missing argument exit 2.
- Jest: `SKIP_REDIS_TESTS=true npx jest --forceExit <path>`. `tsconfig` excludes tests. DB round-trips only through guarded session TEMP tables or the existing `describeDb` pattern; never migrate a shared local database.
- Commits: Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Public repo: no hostnames, IPs, keys or machine paths in code or docs.

## Review Focus

1. A token issued before the change (no `tv`) keeps working after deploy while the user's version is 0, and stops working after the first bump. Test in Task 2.
2. Renewal must never fire for a revoked or expired token, and the renewed token must carry the stored version, not the token's. Test in Task 3.
3. Concurrent requests during a password change: the old token gets 401 on the next request; the token returned by the change works. Test in Task 5.
4. A wrong current password on `/auth/password` must not end the frontend session (the 401 handler must skip that endpoint). Test in Task 6.
5. Sign-out when the server is unreachable or the token is already revoked still clears the local session. Test in Task 6.

---

### Task 1: Store a token version per user

**Files:**
- Create: `src/backend/persistence/migrations/044_user_token_version.sql`
- Modify: `src/backend/persistence/schema.sql:33-39` (users table)
- Modify: `src/backend/presentation/http/ports/IAuthUserStore.ts`
- Modify: `src/backend/infrastructure/persistence/repositories/AuthUserRepository.ts` (row type, mapper, `USER_SELECT`, new methods)
- Modify: `src/backend/presentation/testkit/support.ts` (`InMemoryAuthStore`)
- Test: `src/backend/infrastructure/persistence/__tests__/newRepositories.test.ts`, new `src/backend/presentation/testkit/__tests__/InMemoryAuthStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface AuthUserRecord { /* existing */ tokenVersion: number }
  interface IAuthUserStore {
    /* existing */
    bumpTokenVersion(userId: string): Promise<number>;            // new version; rejects NotFoundError if no row
    updatePassword(userId: string, passwordHash: string): Promise<number>; // sets hash AND bumps; new version; rejects NotFoundError
  }
  ```
  `NotFoundError` from `src/backend/domain/shared/DomainError.ts`. SQL: one `UPDATE ... SET token_version = token_version + 1 ... RETURNING token_version` per method.

- [ ] **Step 1: Write the failing tests**
  - Mapper: `AuthUserMapper` maps row `token_version: 3` to `tokenVersion: 3`.
  - `describeDb` block (existing pattern): after `create`, `findById(...).tokenVersion` is `0`; `bumpTokenVersion` returns `1` then `2`; `updatePassword(id, 'h2')` returns `3` and `findById` shows `passwordHash: 'h2'`, `tokenVersion: 3`; `bumpTokenVersion(randomUUID())` rejects with `NotFoundError`.
  - `InMemoryAuthStore.test.ts`: the same four behaviours against the in-memory store.
- [ ] **Step 2: Run** `SKIP_REDIS_TESTS=true npx jest --forceExit src/backend/infrastructure/persistence/__tests__/newRepositories.test.ts src/backend/presentation/testkit` — expected FAIL (missing members).
- [ ] **Step 3: Implement** the migration (`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`), the same column in `schema.sql`, the port members, repository and in-memory store.
- [ ] **Step 4: Run** the Step 2 command (expected PASS; the DB block runs only with `DATABASE_URL`, say in the report whether it ran) and `npm run -s type-check`.
- [ ] **Step 5: Commit** `feat(auth): store a token version per user`

### Task 2: Embed and check the token version

**Files:**
- Modify: `src/backend/presentation/http/middleware/AuthMiddleware.ts` (`JwtPayload`, `signToken`, `authMiddleware`)
- Modify: `src/backend/presentation/http/types/express.d.ts` (`req.user.tokenVersion`, `req.currentUser`)
- Modify: `src/backend/presentation/http/middleware/CurrentPrincipalMiddleware.ts`
- Modify: `src/backend/presentation/http/controllers/AuthController.ts` (login/register sign with `user.tokenVersion`; `me` reads `req.currentUser`)
- Modify: `src/backend/presentation/http/routes/auth.ts`, `src/backend/presentation/http/routes/index.ts` (wire the check on `/auth/me`)
- Test: `src/backend/presentation/__tests__/api.integration.test.ts` (new `describe('token revocation')`)

**Interfaces:**
- Consumes: `IAuthUserStore.bumpTokenVersion`, `AuthUserRecord.tokenVersion` (Task 1).
- Produces:
  ```ts
  interface JwtPayload { userId: string; workspaceId?: string; tokenVersion: number } // serialised as claim `tv`
  function signToken(payload: JwtPayload): string;
  // req.user: { userId: string; workspaceId?: string; tokenVersion: number; issuedAt: number /* iat, seconds */ }
  // req.currentUser?: AuthUserRecord
  function requireCurrentPrincipal(users: IAuthUserStore): RequestHandler;          // exists + version; sets req.currentUser
  function requireCurrentWorkspacePrincipal(users: IAuthUserStore): RequestHandler; // above + existing workspace rule
  ```
  Task 3 adds renewal inside these two handlers; keep the version check in one shared function they both call.

- [ ] **Step 1: Write the failing tests** (`describe('token revocation')`, using the in-memory store via the existing test app setup):
  - `it('accepts a token issued before token versions existed while the user is at version 0')`: sign with `jwt.sign({ userId, workspaceId }, secret)` (no `tv`) → `GET /api/products` 200 and `GET /api/auth/me` 200.
  - `it('refuses every token of a user after the version is bumped')`: log in, `await store.bumpTokenVersion(id)` → products and `/auth/me` answer 401 with message `'Session has been revoked'`; the legacy no-`tv` token also 401.
  - `it('issues tokens that carry the current version')`: after one bump, log in again → decoded token has `tv: 1` and works.
  - Existing `/auth/me` and auth tests stay green.
- [ ] **Step 2: Run** `SKIP_REDIS_TESTS=true npx jest --forceExit src/backend/presentation/__tests__/api.integration.test.ts -t "token revocation"` — expected FAIL.
- [ ] **Step 3: Implement**: `signToken` writes `tv`; `authMiddleware` reads `tv` (missing → 0; present but not a non-negative integer → 401 `'Invalid token payload'`) and `iat`; the shared check loads the user, answers 401 `'Authenticated user no longer exists'` (existing copy) or `'Session has been revoked'`, sets `req.currentUser`; wire `requireCurrentPrincipal` after `authMiddleware` and `meLimiter` on `/auth/me`; `me` uses `req.currentUser`.
- [ ] **Step 4: Run** the auth and token-revocation tests plus `src/backend/presentation/__tests__/idor.integration.test.ts`; `npm run -s type-check`. Expected PASS.
- [ ] **Step 5: Commit** `feat(auth): refuse tokens whose version was revoked`

### Task 3: 24-hour lifetime with sliding renewal (backend)

**Files:**
- Create: `src/backend/config/duration.ts`, `src/backend/config/__tests__/duration.test.ts`
- Modify: `src/backend/config/env.ts` (jwt section, boot problems, warning), `src/backend/__tests__/main.boot.test.ts`
- Modify: `src/backend/presentation/http/middleware/CurrentPrincipalMiddleware.ts` (renewal)
- Modify: `src/backend/presentation/http/app.ts:160` (`exposedHeaders`)
- Modify: `docker-compose.yml:124`, `.env.example` (`JWT_EXPIRATION=24h`, `JWT_RENEW_AFTER=12h`, comment that `JWT_REFRESH_SECRET` is unused)
- Test: `api.integration.test.ts` (`describe('token renewal')`)

**Interfaces:**
- Consumes: the shared check and `req.user.issuedAt` (Task 2).
- Produces:
  ```ts
  function parseDurationMs(value: string): number | null; // /^(\d+)(s|m|h|d)$/, else null
  // env.jwt: { secret, expiration: string, expirationMs: number, renewAfterMs: number, refreshSecret, refreshExpiration }
  const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'; // exported from CurrentPrincipalMiddleware.ts
  ```

- [ ] **Step 1: Write the failing tests**
  - `duration.test.ts`: `'24h'` → `86_400_000`, `'12h'`, `'7d'`, `'90m'`, `'30s'`; `'2 days'`, `'120'`, `''`, `'1.5h'`, `'-1h'` → `null`.
  - `main.boot.test.ts`: unset → expiration `24h`, renewAfter `12h`; `JWT_EXPIRATION=abc` → boot problem naming `JWT_EXPIRATION`; `JWT_RENEW_AFTER=24h` with `JWT_EXPIRATION=24h` → boot problem naming `JWT_RENEW_AFTER`; `JWT_EXPIRATION=7d` boots and logs exactly one warning containing `JWT_EXPIRATION` and `24h`.
  - `describe('token renewal')`: a token with `iat` 13 h ago (sign with `jwt.sign({..., tv: 0, iat: now-13h}, secret, { expiresIn: '24h' })`) → `GET /api/products` 200 with header `x-renewed-token`, which decodes to the same `userId`/`workspaceId`, `tv` equal to the stored version, and works on a following request; a token 1 h old → no header; a revoked token 13 h old → 401 and no header; same three on `/api/auth/me`.
- [ ] **Step 2: Run** the three test files — expected FAIL.
- [ ] **Step 3: Implement** `parseDurationMs`; env parsing with the boot problems and warning (follow the existing `problems.push` / fix-hint style); renewal in the shared check after a successful version check: when `Date.now() - issuedAt*1000 > env.jwt.renewAfterMs`, set the header to `signToken({ userId, workspaceId: current.workspaceId ?? undefined, tokenVersion: current.tokenVersion })`; add the header to `exposedHeaders`; compose and `.env.example`.
- [ ] **Step 4: Run** the Step 2 tests plus the whole `src/backend/presentation` folder; `npm run -s type-check`. Expected PASS.
- [ ] **Step 5: Commit** `feat(auth): expire idle sessions after a day and renew active ones`

### Task 4: Sign out on the server and the operator command

**Files:**
- Modify: `src/backend/presentation/http/routes/auth.ts`, `src/backend/presentation/http/controllers/AuthController.ts` (`logout`)
- Create: `src/backend/persistence/revokeTokens.ts`, `src/backend/persistence/__tests__/revokeTokens.test.ts`
- Modify: `package.json` (`auth:revoke`, `build:revoke` added to `build:backend` like `build:migrate`)
- Test: `api.integration.test.ts`

**Interfaces:**
- Consumes: `requireCurrentPrincipal`, `IAuthUserStore.bumpTokenVersion`, `findByEmail` (Tasks 1–2).
- Produces:
  ```ts
  // revokeTokens.ts
  export async function revokeTokens(
    email: string | undefined,
    users: Pick<IAuthUserStore, 'findByEmail' | 'bumpTokenVersion'>,
    out: { log(msg: string): void; error(msg: string): void },
  ): Promise<0 | 1 | 2>; // exit code; main() wires AuthUserRepository + process.exit
  ```
  `POST /auth/logout` → `204`, no body.

- [ ] **Step 1: Write the failing tests**
  - `it('signs out every device')`: two logins (tokens A, B) → `POST /api/auth/logout` with A → 204; A and B both 401 `'Session has been revoked'` on `/api/products`; a new login works.
  - `it('refuses sign-out with a revoked token')` → 401.
  - `revokeTokens.test.ts` (in-memory fakes): known e-mail (different case) → returns 0, logs `'Revoked all sessions of <email as typed>'`, version bumped; unknown → 1 and an error line; `undefined` → 2 and a usage line containing `auth:revoke`.
- [ ] **Step 2: Run** the tests — expected FAIL.
- [ ] **Step 3: Implement** the route (`authMiddleware`, `meLimiter`, `requireCurrentPrincipal`, then the controller), the script (`main()` only when run directly, closing the pool), the npm scripts (`auth:revoke`: `node --loader ts-node/esm src/backend/persistence/revokeTokens.ts`; `build:revoke`: esbuild to `dist/backend/revokeTokens.js` with the same flags as `build:migrate`).
- [ ] **Step 4: Run** the tests, `npm run -s type-check`, and `npm run -s build:backend` (expect `dist/backend/revokeTokens.js`).
- [ ] **Step 5: Commit** `feat(auth): sign out every device and let operators revoke sessions`

### Task 5: Change password (backend)

**Files:**
- Modify: `src/backend/presentation/http/validation/schemas.ts` (`changePasswordSchema`)
- Modify: `src/backend/presentation/http/middleware/RateLimitMiddleware.ts` (`passwordChangeRateLimiter`)
- Modify: `src/backend/presentation/http/routes/auth.ts`, `routes/index.ts` (create the limiter where the other limiters are created and pass it in `AuthRouteOptions`), `controllers/AuthController.ts` (`changePassword`)
- Test: `api.integration.test.ts`, `RateLimitMiddleware` tests if they exist next to it

**Interfaces:**
- Consumes: `IAuthUserStore.updatePassword`, `requireCurrentPrincipal`, `signToken`.
- Produces: `POST /auth/password` body `{ currentPassword: string; newPassword: string }` → `200 { token: string }`; `passwordChangeRateLimiter(limit = 5, windowMs = 15 * 60_000)` keyed by `req.user.userId`, `skipSuccessfulRequests: true`.

- [ ] **Step 1: Write the failing tests**
  - `it('changes the password, keeps this device and signs out the others')`: tokens A, B; `POST /api/auth/password` with A `{ currentPassword: <the test file's existing password value>, newPassword: <a second value built at runtime, e.g. `${existing}-changed`> }` → 200 `{ token: C }` (no new password-looking literals: Gitleaks scans the branch history); A and B 401; C 200; login with the old password 401, with the new one 200.
  - `it('refuses a wrong current password without revoking anything')` → 401 `'Current password is incorrect'`; A still 200.
  - `it('validates the new password')`: 7 characters → 400; equal to current → 400.
  - `it('limits failed password changes per user')`: 5 wrong attempts → 401 each, the 6th → 429; a correct change after a success does not count (with a fresh user: success, then 5 wrong → still 401 on the 5th).
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** schema (`newPassword` min 8, refine differs), limiter, route order `authMiddleware → meLimiter → requireCurrentPrincipal → validateBody → passwordLimiter → controller`, controller (`bcrypt.compare` against `req.currentUser.passwordHash`; `bcrypt.hash(newPassword, BCRYPT_ROUNDS)`; `updatePassword`; respond with `signToken` for the new version).
- [ ] **Step 4: Run** the tests and `npm run -s type-check`. Expected PASS.
- [ ] **Step 5: Commit** `feat(auth): change the password and sign out other devices`

### Task 6: Frontend session handling (renewal, sign-out)

**Files:**
- Modify: `src/frontend/state/slices/authSlice.ts` (`setToken`), `src/frontend/state/api/baseApi.ts`, `src/frontend/state/api/authApi.ts` (`logout`, `changePassword` endpoints), `src/frontend/components/layout/Sidebar.tsx` (`handleSignOut`)
- Test: `src/frontend/state/api/baseApi.test.ts`, `src/frontend/state/slices/authSlice.test.ts` (create if absent), Sidebar pure helper test if one exists

**Interfaces:**
- Consumes: `/auth/logout` (204), `/auth/password` (200 `{ token }`), header `X-Renewed-Token`.
- Produces:
  ```ts
  setToken(token: string) // authSlice action: replaces token in state and localStorage, keeps user
  // authApi: logout: mutation<void, void>; changePassword: mutation<{ token: string }, { currentPassword: string; newPassword: string }>
  // exports: useLogoutMutation, useChangePasswordMutation
  ```

- [ ] **Step 1: Write the failing tests**
  - `authSlice`: `setToken('t2')` replaces the token, keeps `user`, persists to `localStorage` (existing persist helper).
  - `baseApi.test.ts`: a 200 response with `x-renewed-token: t2` while the session token is still the sent one → dispatches `setToken('t2')`; when the session token changed meanwhile (sign-out or new sign-in) → no dispatch; a 401 from endpoint `changePassword` → no `logout()`, no toast; a 401 from another endpoint → existing behaviour.
  - Sign-out: extract the sign-out flow into a pure async helper `signOut({ callLogout, dispatch })` (in `Sidebar.tsx` or a small module next to it) and test: server 204 → `logout()` dispatched; `callLogout` rejects (network, 401) → `logout()` still dispatched.
- [ ] **Step 2: Run** the tests — expected FAIL.
- [ ] **Step 3: Implement**: reading the header from `result.meta?.response?.headers`; the endpoint-name exclusion next to the existing `login` exclusion; endpoints; `handleSignOut` calls the helper with the logout mutation.
- [ ] **Step 4: Run** `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend` and `npm run -s type-check`. Expected PASS.
- [ ] **Step 5: Commit** `feat(ui): keep active sessions renewed and sign out on the server`

### Task 7: Change-password card in Settings

**Files:**
- Modify: `src/frontend/pages/SettingsPage.tsx` (General section; follow the existing `Card` usage)
- Create: `src/frontend/pages/changePasswordForm.ts` (pure validation and submit outcome), `src/frontend/pages/changePasswordForm.test.ts`
- Test: `src/frontend/pages/SettingsPage.render.test.tsx`

**Interfaces:**
- Consumes: `useChangePasswordMutation`, `setToken`, `enqueueToast` (Task 6).
- Produces:
  ```ts
  type ChangePasswordFields = { currentPassword: string; newPassword: string; repeatPassword: string };
  function validateChangePassword(f: ChangePasswordFields): Partial<Record<keyof ChangePasswordFields, string>>;
  // errors: newPassword < 8 chars → 'Use at least 8 characters'; repeat mismatch → 'Passwords do not match';
  // newPassword === currentPassword → 'Choose a different password'; empty current → 'Enter your current password'
  ```

- [ ] **Step 1: Write the failing tests**
  - `changePasswordForm.test.ts`: each error above for its input; a valid set → `{}`.
  - `SettingsPage.render.test.tsx`: the General section renders a "Change password" card with three password inputs (`type="password"`, `autocomplete` `current-password` / `new-password`).
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the card: submit disabled while validation fails or the request is in flight; on success `dispatch(setToken(token))`, clear the fields, toast `'Password changed. Other devices have been signed out.'`; on 401 show `'Current password is incorrect'` under the current-password field; on 429 show `'Too many attempts. Try again later.'`.
- [ ] **Step 4: Run** `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/pages` and `npm run -s type-check`. Expected PASS.
- [ ] **Step 5: Commit** `feat(ui): change the password from Settings`

### Task 8: Sessions documentation and whole-branch checks

**Files:**
- Modify: `docs/deployment/caddy-cloudflare-vps.md` (new "Sessions" section), `docs/deployment/local-docker-runbook.md` if it mentions `JWT_EXPIRATION`

- [ ] **Step 1: Write the "Sessions" section**: 24 h idle lifetime and 12 h renewal (`JWT_EXPIRATION`, `JWT_RENEW_AFTER`), existing `.env` files with `JWT_EXPIRATION=7d` should change it to `24h` (boot warns otherwise); sign-out signs out every device; password change in Settings signs out other devices; the operator command for an incident in both forms: `npm run auth:revoke -- <email>` and `docker compose exec app node dist/backend/revokeTokens.js <email>`.
- [ ] **Step 2: Leak check**: `git diff origin/main -- docs .env.example | grep -E -i '([0-9]{1,3}\.){3}[0-9]{1,3}|hetzner|/home/|/Users/' | grep -v '127.0.0.1'` → no output.
- [ ] **Step 3: Commit** `docs: describe session lifetime, sign-out and revocation`
- [ ] **Step 4: Whole-branch checks**: `npm run -s type-check && npm run -s lint && npm run -s build`; `SKIP_REDIS_TESTS=true npm run -s test:ci`; `git diff origin/main -- src | grep -n -E '^\+.*(TODO|FIXME|\.only\(|\.skip\(|not implemented)'` → no output; `gitleaks git --log-opts="origin/main..HEAD" --redact --no-banner` → no leaks.
