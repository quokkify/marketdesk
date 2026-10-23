# MarketDesk MVP Reanimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MarketDesk start from a clean checkout and let an external tester run the full journey (register → product with photos → OLX sandbox listing → publish → AI suggestions → dashboard/analytics) with an honest UI that follows the original PRD/companion design.

**Architecture:** Keep the layered Express 5 backend and the React 19 + MUI 9 + RTK Query frontend. Add an explicit *sandbox* path for OLX when `OLX_ADAPTER_MODE != real` (sandbox account, stub taxonomy, sandbox quota) so every safety gate stays wired but can be satisfied without real credentials. Add an offline heuristic AI provider behind the existing `IAIProvider` port with an `auto|hermes|offline` switch so AI features degrade honestly when the Hermes Agent API is unreachable. Fix the MUI v9 prop regression, retheme to the PRD tokens, and rebuild the screens that diverge from the companion.

**Tech Stack:** Node 24, TypeScript 6, Express 5, PostgreSQL 18, Redis 8 (Bull), React 19, MUI 9.5, RTK Query, Vite 8, Jest 30 (swc), Playwright, Zod 4.

**Spec:** `docs/design/MarketDesk PRD.dc.html` (18 sections, the acceptance contract), `docs/design/MarketDesk.dc.html` (visual companion; CSS tokens extracted below), `docs/spec/PRODUCT.md` (approved deviations: OLX-only, honest roadmap cards, below-cost confirmation), audit findings summarised in the vault note `10.13 MarketDesk — реанимация до MVP` (quokkify/knowledge). Reference screenshots of the companion live in `tmp/shots/` output dirs of the night session; the curated ones are in `quokkify/.github/assets/projects/marketdesk/`.

## Global Constraints

- Branch `feat/mvp-reanimation`; never commit to `main`. Conventional Commit titles, lowercase scope, e.g. `fix(auth): ...`. Co-Authored-By trailer as configured for the session.
- Repo is public: no secrets, no employer hosts, no machine paths in committed files. `.env` stays untracked.
- Honesty rule from `docs/spec/PRODUCT.md`: nothing visible may claim a capability that is not real. Unavailable features are explicit roadmap/unavailable surfaces, never fake data or dead primary buttons.
- OLX is the only live marketplace. Other channels appear only as roadmap cards with no connect flow.
- Sandbox mode must be unmistakable in the UI (chip/label "Sandbox" wherever OLX state is shown) and must never make real OLX calls.
- Keep `npm run type-check`, `npm run lint` (0 errors), `npm run build`, `npm run verify:spec`, `npm run verify:compose-db`, `npm run verify:compose-uploads`, `npm run verify:brand-assets`, `npm run verify:release-metadata` green. Run targeted Jest with `SKIP_REDIS_TESTS=true npx jest <path>`; DB-gated suites skip when `DATABASE_URL` is unset.
- Delete the type shim `src/frontend/mui-v9-legacy-props.d.ts` (Task D1) and never re-add it.
- UI copy is English only.
- PRD tokens (companion CSS variables): light `bg #F6F7F9, surface #FFFFFF, surface-2 #F2F3F6, surface-3 #ECEEF2, border #E7E9EF, border-strong #DCDFE7, text #191B23, text-2 #5B606E, text-3 #8B90A0, primary #5B5BD6, primary-hover #4F4FCA, primary-weak #EEEEFB, success #1C9C6B/#E6F6EE, warning #C67A12/#FBF0DD, danger #D1435B/#FBE9EC, info #2B7FD4/#E7F1FC`; dark `bg #0C0D11, surface #16171D, surface-2 #1C1E26, surface-3 #23262F, border #25272F, border-strong #31343E, text #ECEEF4, text-2 #A4A9B8, text-3 #6B7080, primary #8B8BF2, primary-hover #9B9BF6, primary-weak #1F2036, success #3ECF8E/#12261E, warning #E0A94A/#2A2113, danger #F2647D/#2C1620, info #5AA9F0/#122132, sidebar #0F1014`. Shadows: sm `0 1px 2px rgba(19,22,33,.05), 0 1px 1px rgba(19,22,33,.03)`, md `0 4px 14px rgba(19,22,33,.06), 0 1px 3px rgba(19,22,33,.04)`, lg `0 18px 48px rgba(19,22,33,.12), 0 4px 12px rgba(19,22,33,.06)`. Fonts: Manrope (UI, tabular numerals) + JetBrains Mono (SKU/keys). Radii: inputs/buttons 10, chips 6–7, cards 16–20, icon buttons 36–38px square radius 10. Sidebar 250px, top bar 64px. Marketplace brand colours: OLX #12B6AB, Allegro #FF5A00, Vinted #09B1BA, Facebook #1877F2, eBay #E53238, Etsy #F56400, Amazon #FF9900.

## Review Focus

1. A tester who copies `.env.example` unchanged must get a loud, actionable startup failure, never a server that answers `/health` OK while every `/api` route is 404 (Task A1 test `boot fails fast when MARKETPLACE_CREDENTIALS_KEY is empty`).
2. A tester who registers with an empty workspace name must still land in a working workspace (Task A2 test `register without workspaceName provisions a default workspace`).
3. In sandbox mode the whole publish path (connect → listing draft → category → preview → publish → live) must work through HTTP with no real OLX call, and every response that reaches the UI must carry `sandbox: true` so the UI can label it (Task B4 integration test `sandbox publish journey`).
4. With Hermes unreachable, no UI action may hang longer than 30 s or return HTTP 500; every AI result must say which provider produced it (Task C1/C2 tests `offline provider is used when Hermes is not configured`, `Hermes transport errors map to 503`).
5. A JWT that expires mid-session must log the tester out with one toast, and a transient network error must not (Task D3 test `401 dispatches logout once`, `FETCH_ERROR keeps session`).

---

## Lane A — boot, environment, authentication (backend + login page)

### Task A1: Fail-fast boot, `env:init` script, Compose contract

**Files:**
- Create: `scripts/init-env.mjs`
- Modify: `src/backend/main.ts:68-98` (remove health-only fallback), `src/backend/config/env.ts` (JWT placeholder warning + `MARKETPLACE_CREDENTIALS_KEY` validation helper), `docker-compose.yml` (app + migrate env), `.env.example`, `docs/deployment/local-docker-runbook.md` (currently untracked; commit it), `package.json` (`env:init` script), `README.md` Quick Start.
- Test: `src/backend/config/__tests__/env.test.ts` (extend or create), `scripts/init-env.test.mjs` (node:test), `src/backend/__tests__/main.boot.test.ts` (new; spawn-free unit around a new `assertStartupConfiguration(env)` helper).

**Interfaces:**
- Produces: `export function assertStartupConfiguration(e: typeof env): void` in `src/backend/config/env.ts` — throws `Error` whose message names every missing/invalid variable and the fix command (`npm run env:init` / `openssl rand -base64 32`). Called from `main.ts` before `resolveContainer()`.
- Produces: `npm run env:init` — copies `.env.example` to `.env` when absent, then replaces empty or `your_`-prefixed values of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `HERMES_WEBHOOK_SECRET`, `MARKETPLACE_CREDENTIALS_KEY` with `crypto.randomBytes(32).toString('base64')`; never overwrites other keys; prints which keys it set. Idempotent.
- Produces: in `docker-compose.yml` the `app` and `migrate` services get `MARKETPLACE_CREDENTIALS_KEY: ${MARKETPLACE_CREDENTIALS_KEY:?MARKETPLACE_CREDENTIALS_KEY must be set (run npm run env:init)}`; `NODE_ENV` default stays `development` for Compose but the JWT placeholder is refused in every environment unless `ALLOW_INSECURE_DEV_JWT=true`.

- [ ] **Step 1: Write failing tests**

```ts
// src/backend/config/__tests__/env.test.ts
it('assertStartupConfiguration rejects an empty MARKETPLACE_CREDENTIALS_KEY with the fix command', () => {
  expect(() => assertStartupConfiguration({ ...env, marketplaceCredentialsKey: '' }))
    .toThrow(/MARKETPLACE_CREDENTIALS_KEY.*npm run env:init/);
});
it('assertStartupConfiguration rejects a placeholder JWT_SECRET unless ALLOW_INSECURE_DEV_JWT=true', () => { /* set process.env and expect throw / no throw */ });
// scripts/init-env.test.mjs (node:test, uses a temp dir)
test('init-env fills placeholders and keeps other keys', ...)
test('init-env is idempotent', ...)
```

- [ ] **Step 2: Run tests, verify they fail** — `SKIP_REDIS_TESTS=true npx jest src/backend/config && node --test scripts/init-env.test.mjs`
- [ ] **Step 3: Implement** `assertStartupConfiguration`, call it in `main.ts` before wiring, delete the health-only branch (wiring failure → log error → `process.exit(1)` via the existing fatal path in every environment), log one startup banner line `{ olxAdapterMode, hermesProviderMode }`. Implement `scripts/init-env.mjs`. Update compose, `.env.example` (set `HERMES_REQUEST_TIMEOUT_MS=30000`, add comments), runbook, README Quick Start (`npm run env:init` before `docker compose up`).
- [ ] **Step 4: Verify** — tests pass; `npm run verify:compose-db && npm run verify:compose-uploads` pass; `docker compose config` renders with a key set and fails without it.
- [ ] **Step 5: Commit** `fix(boot): fail fast on missing secrets and add env:init bootstrap`

### Task A2: Registration always provisions a workspace

**Files:**
- Modify: `src/backend/presentation/http/validation/schemas.ts:257-261`, `src/backend/presentation/http/controllers/AuthController.ts:77-125`, `src/frontend/pages/LoginPage.tsx:99-107`, `src/frontend/state/api/authApi.ts`.
- Test: `src/backend/presentation/__tests__/api.integration.test.ts` (register cases), `src/frontend/pages/LoginPage.test.tsx` (new, renderToStaticMarkup style used in repo).

**Interfaces:**
- `registerSchema.workspaceName`: `z.string().trim().min(1).max(120).optional()`; `AuthController.register` derives `workspaceName ?? defaultWorkspaceName(email)` where `defaultWorkspaceName('kamil@x.pl') === "kamil's workspace"`; a workspace and the OLX marketplace row are always created; duplicate-email race (pg 23505) maps to 409.

- [ ] **Step 1: Failing tests** — `register without workspaceName provisions a default workspace and OLX row` (expects `token` payload with `workspaceId`, `GET /api/marketplaces` returns one OLX row); `LoginPage registration marks Workspace name required`.
- [ ] **Step 2: Run, verify fail.** `SKIP_REDIS_TESTS=true npx jest src/backend/presentation/__tests__/api.integration.test.ts -t register`
- [ ] **Step 3: Implement** (controller default + required field + 23505→409 in `ResponseFormatter.statusForError`).
- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** `fix(auth): always provision a workspace on registration`

### Task A3: Session expiry handling and rate-limit hygiene

**Files:**
- Modify: `src/frontend/state/api/baseApi.ts`, `src/frontend/components/AuthBootstrap.tsx:50-52`, `src/backend/presentation/http/routes/auth.ts:15-20,37`, `src/backend/config/env.ts` (`JWT_EXPIRATION` default `7d`; `JWT_REFRESH_SECRET` no longer fail-closed), `.env.example`, `docs/deployment/caddy-cloudflare-vps.md` (document `TRUST_PROXY=true`).
- Test: `src/frontend/state/api/baseApi.test.ts` (new), `src/backend/presentation/__tests__/api.integration.test.ts` (`/auth/me` limiter keyed by user).

**Interfaces:**
- `baseQueryWithAuth: BaseQueryFn` wraps `fetchBaseQuery`; on `error.status === 401` dispatches `logout()` and `enqueueToast({ message: 'Your session expired. Please sign in again.', severity: 'warning' })` once per expiry (guard with a module flag reset on successful login).
- `AuthBootstrap` logs out only when `me.error.status` is 401 or 403; other errors keep the session.
- `/auth/me` limiter moves after `authMiddleware` and keys by `req.user.userId`.

- [ ] Steps: failing tests → implement → verify → commit `fix(auth): handle expired sessions and user-keyed me limiter`.

## Lane B — OLX sandbox mode (backend)

### Task B1: Sandbox connect in `MarketplaceOAuthService`

**Files:**
- Modify: `src/backend/application/services/MarketplaceOAuthService.ts` (deps + `start`), `src/backend/config/di/container.ts:302-326`, `src/backend/presentation/http/controllers/MarketplaceController.ts:93-100,206-234` (list/get views gain `sandbox`), `src/backend/application/dto/presenters.ts` (MarketplaceView), `src/shared/types/index.ts` (Marketplace view type: `sandbox: boolean`), `src/frontend/state/api/dto.ts` if it mirrors.
- Test: `src/backend/application/__tests__/MarketplaceOAuthService.test.ts` (extend), `src/backend/presentation/__tests__/api.integration.test.ts`.

**Interfaces:**
- `MarketplaceOAuthServiceDeps.sandbox?: { enabled: boolean; successUrl: string }`.
- `start()` when `sandbox.enabled`: upsert account `{ handle: 'OLX sandbox account', status: 'connected', scopes: ['read','write','v2'], credentials: vault.encrypt({ accessToken: 'sandbox', tokenType: 'Bearer', scopes, expiresAt: now + 10 years }) }`, call `marketplace.connect()` + `marketplaceRepo.save`, return `{ authorizationUrl: `${successUrl}?oauth=success&marketplaceId=<id>&sandbox=1`, state: 'sandbox', expiresAt, sandbox: true }` (`MarketplaceOAuthStartResult` gains optional `sandbox?: boolean`). `check()` returns `sandbox: true` in `MarketplaceOAuthStatus` when the stored handle is the sandbox handle. No app credentials required in sandbox mode.
- `MarketplaceView.sandbox = env.marketplaces.olx.adapterMode !== 'real'` for `key === 'olx'`.
- Container passes `sandbox: { enabled: adapterMode !== 'real', successUrl: env.marketplaces.olx.oauthSuccessUrl }`.

- [ ] **Step 1: Failing tests** — `start() in sandbox mode connects the marketplace without app credentials and returns the success URL`; `start() in real mode still requires app credentials`; integration `POST /api/marketplaces/:id/connect in stub mode marks OLX connected and GET /api/marketplaces reports sandbox:true`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify pass** (`SKIP_REDIS_TESTS=true npx jest src/backend/application/__tests__/MarketplaceOAuthService.test.ts src/backend/presentation/__tests__/api.integration.test.ts`).
- [ ] **Step 5: Commit** `feat(olx): sandbox connection when the adapter runs in stub mode`

### Task B2: Stub taxonomy resolver and sandbox quota

**Files:**
- Create: `src/backend/infrastructure/adapters/StubOlxTaxonomyResolver.ts`
- Modify: `src/backend/config/di/container.ts:430-436,705-712` (use the stub resolver when `adapterMode !== 'real'`), `src/backend/application/services/OlxPublicationQuotaService.ts` (`sandboxMode` option), `src/backend/presentation/http/controllers/ListingController.ts` (category search/verify no longer 404/503 in stub mode).
- Test: `src/backend/infrastructure/adapters/__tests__/StubOlxTaxonomyResolver.test.ts` (new), `src/backend/application/__tests__/OlxPublicationQuotaService.test.ts` (extend).

**Interfaces:**
- `export class StubOlxTaxonomyResolver implements OlxTrustedTaxonomyResolver { verify(id): Promise<MarketplaceCategoryMetadata>; search(query, limit?): Promise<OlxCategorySearchResult[]> }` with a static tree of 8 leaf categories: `1001 Electronics › Cameras`, `1002 Electronics › Phones`, `1003 Electronics › Audio › Headphones`, `1004 Electronics › Computers`, `2001 Fashion › Clothing`, `3001 Home & Garden › Furniture`, `4001 Sports & Hobby › Equipment`, `9001 Other`. `verify` of a non-leaf/unknown id rejects exactly like the real resolver (same error class). Returned metadata has `source: 'provider_taxonomy'`, `isLeaf: true`, `taxonomyVerifiedAt: now`, `taxonomyStaleAt: now + 7d`.
- `OlxPublicationQuotaService` constructor option `sandboxMode: boolean`; when true and no quota row exists, `preview()` and the authorize path return `{ decision: 'allow', status: 'available', reason: 'sandbox_unlimited', requiresOverride: false }` and persist no quota row.

- [ ] **Step 1: Failing tests** — `search('head') returns the Headphones leaf`; `verify('1003') returns leaf metadata`; `verify('1000') rejects`; `preview() in sandbox mode allows publication when no quota row exists`; `preview() in real mode still blocks with quota_unknown`.
- [ ] **Step 2: Run, verify fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** `feat(olx): stub taxonomy and sandbox quota for stub mode`

### Task B3: Issue #278 — sync must not erase a verified category

**Files:**
- Modify: `src/backend/infrastructure/adapters/OLXAdapter.ts:644-654`, `src/backend/infrastructure/jobQueue/JobHandlers/SyncMarketplaceHandler.ts:250-254`, `src/backend/config/di/container.ts:609-613`.
- Test: `src/backend/infrastructure/adapters/__tests__/OLXAdapter.test.ts`, `src/backend/infrastructure/jobQueue/__tests__/jobHandlers.test.ts`.

**Interfaces:** `extractMarketplaceCategory` returns `undefined` when the payload has no `category` key (null only for explicit `category: null` or an invalid shape); the handler pushes a mismatch candidate only when the new category is non-null and differs from the stored one; the account-binding guard runs only when candidates exist.

- [ ] Steps: regression tests `verified category survives a sync payload without category` and `stub-mode sync with an externally identified listing completes` → implement → verify → commit `fix(olx): preserve verified category when sync payload omits it (#278)`.

### Task B4: Sandbox publish journey integration test and stub adapter polish

**Files:**
- Modify: `src/backend/infrastructure/adapters/OLXAdapter.ts:669-720` (stub responder returns `url: 'https://www.olx.pl/d/oferta/sandbox-<id>'`, deterministic `metrics` that grow per GET: views +7, favorites +1, messages 0), `src/backend/presentation/http/controllers/ListingController.ts` (publish preview carries `sandbox`), `src/backend/application/usecases/PublishListingUseCase.ts` (absolute image URLs: `PUBLIC_BASE_URL` env, default derived from `OLX_REDIRECT_URI` origin or `http://localhost:3000`).
- Test: `src/backend/__tests__/e2e/sandboxPublishJourney.e2e.test.ts` (new, HTTP over `buildApp` with in-memory repos like the existing e2e).
- Also modify: `src/backend/presentation/http/controllers/ProductController.ts:183-190` + `ProductApplicationService` — `DELETE /products/:id` returns 409 `ConflictError('Remove the live listing from the marketplace before deleting this product')` while any listing is `live` or has a `marketplace_listing_id`; `ResponseFormatter.statusForError` maps pg `23503`/`23505` to 409; after a successful delete, best-effort unlink image files referenced only by that product.

- [ ] **Step 1: Failing test** `sandbox publish journey`: register → connect (sandbox) → create product → `POST /products/:id/listings` → `PUT /listings/:id/marketplace-category {providerCategoryId:'1001'}` → `POST /listings/:id/publish-preview` has `canPublish: true` and `sandbox: true` → `POST /listings/:id/publish` → listing status `live`, `externalUrl` starts with `https://www.olx.pl/d/oferta/sandbox-`.
- [ ] Steps: run (fail) → implement → verify → commit `feat(olx): end-to-end sandbox publish journey`.

## Lane C — Hermes degradation and AI truthfulness (backend)

### Task C1: Offline heuristic provider, provider mode switch, status endpoint

**Files:**
- Create: `src/backend/infrastructure/external/OfflineHeuristicAIProvider.ts`, `src/backend/infrastructure/external/AIProviderSelector.ts`, `src/backend/infrastructure/external/HermesHealthProbe.ts`.
- Modify: `src/backend/config/env.ts` (`hermes.providerMode: 'auto' | 'hermes' | 'offline'` from `HERMES_PROVIDER_MODE`, default `auto`), `src/backend/config/di/container.ts:247-248`, `src/backend/presentation/http/routes/hermes.ts` + `HermesController.ts` (`GET /api/hermes/status`), `src/shared/types/index.ts` (`HermesStatusView`), `.env.example`.
- Test: `src/backend/infrastructure/external/__tests__/OfflineHeuristicAIProvider.test.ts`, `__tests__/AIProviderSelector.test.ts`, `src/backend/presentation/__tests__/api.integration.test.ts` (status route).

**Interfaces:**
- `OfflineHeuristicAIProvider implements IAIProvider`: `suggestPrice` → if `listing.price <= 0` suggests `max(cost * 1.3, 1)` rounded to whole PLN else keeps price unless `recentViews > 50 && conversionRate === 0` (suggest −10 %, floor at cost × 1.05); `confidence: 'low'`; `reasoning` ends with `'Heuristic offline suggestion; Hermes was not consulted.'`. `generateTitle` → trims, collapses whitespace, Title Case first letter, appends condition when missing, max 70 chars. `analyzeListing` → score 100 − 20 per issue (no images, <3 images, description < 80 chars, no tags, title < 15 chars) with suggestion strings. `analyzeListingSeo` → recommendations for `title`/`description` only when the heuristic changes something; `disclaimer: 'Heuristic offline suggestion; Hermes was not consulted.'`.
- `AIProviderSelector`: `constructor(deps: { hermes: IAIProvider; offline: IAIProvider; mode: 'auto'|'hermes'|'offline'; probe: HermesHealthProbe })`; implements `IAIProvider` by delegating per call to `await this.resolve()`: `offline` → offline; `hermes` → Hermes; `auto` → Hermes when `probe.isConfigured() && (await probe.isReachable())`, else offline. Exposes `async status(): Promise<HermesStatusView>`.
- `HermesHealthProbe`: `isConfigured()` = apiUrl non-empty and apiKey non-empty and not `your_`-prefixed; `isReachable()` = `GET ${apiUrl}/models` with `AbortSignal.timeout(3000)`, result cached 60 s.
- `HermesStatusView = { mode: 'auto'|'hermes'|'offline'; activeProvider: 'hermes'|'offline'; hermesConfigured: boolean; hermesReachable: boolean | null; checkedAt: string }`, served by `GET /api/hermes/status` (authenticated).

- [ ] **Step 1: Failing tests** — heuristics (4 cases above), `selector in auto mode uses offline when Hermes is not configured`, `selector in hermes mode never falls back`, `GET /api/hermes/status returns activeProvider offline in tests`.
- [ ] Steps: run (fail) → implement → verify → commit `feat(hermes): offline heuristic provider and provider status`.

### Task C2: 503 mapping, 30 s timeout, honest AI draft fallback

**Files:**
- Modify: `src/backend/infrastructure/external/HermesCompletionClient.ts:40-78` (throw `ServiceUnavailableError('Hermes AI is not reachable in this environment', cause)` for transport/HTTP/timeout failures), `src/backend/infrastructure/external/HermesAI.ts:41` (default timeout 30000), `src/backend/application/services/ProductAIDraftService.ts:13-14,85,128,154` (`confidence: number | null`, `source: 'hermes' | 'heuristic'`, no placeholder description; add `'description'` to `uncertainFields`), `src/backend/presentation/http/controllers/ProductController.ts:171-181`, `src/frontend/components/forms/ProductWizardForm.tsx:463-464` (render `Heuristic draft (Hermes offline)` when `source === 'heuristic'`).
- Test: `HermesCompletionClient.test.ts`, `ProductAIDraftService.test.ts`, `ProductController` integration (`POST /products/:id/improvements` → 503 when provider throws).

- [ ] Steps: failing tests `transport errors become ServiceUnavailableError`, `draft fallback has null confidence and heuristic source`, `improvements returns 503 with stable message` → implement → verify → commit `fix(hermes): map provider failures to 503 and keep AI drafts honest`.

### Task C3: Hermes events summary and #279 sync status

**Files:**
- Modify: `src/backend/application/services/HermesApplicationService.ts`, `src/backend/domain/repositories/interfaces/IEventRepository.ts` + `EventRepository.ts` (+ in-memory testkit) (`summary(workspaceId, since)`), `src/backend/presentation/http/routes/hermes.ts` + `HermesController.ts` (`GET /api/hermes/events/summary`), `src/backend/application/dto/presenters.ts:122-137` (`marketplaceSync?: 'queued' | 'confirmed' | 'failed' | null` read from the latest `hermes_event.approved` activity metadata), `src/shared/types/index.ts`.
- Test: `HermesApplicationService.test.ts`, API integration.

**Interfaces:** `HermesEventSummaryView = { actionsToday: number; awaitingReview: number; completed: number; dismissed: number }` where `actionsToday` counts events created since local midnight (workspace timezone), `awaitingReview` = `pending_review` + `pending_decision`, `completed` = `applied`, `dismissed` = `dismissed`. `HermesEventView.marketplaceSync` added; UI copy for applied events becomes `Applied in MarketDesk · marketplace update {queued|confirmed|failed}` (Task E3 consumes).

- [ ] Steps: failing tests → implement → verify → commit `feat(hermes): events summary endpoint and marketplace sync status (#279)`.

## Lane D — frontend foundation

### Task D1: Remove the MUI v9 legacy prop shim and fix every call site

**Files:**
- Delete: `src/frontend/mui-v9-legacy-props.d.ts`
- Modify: every file `tsc` then flags (expected: `Stack alignItems/justifyContent/flexWrap` → `sx`; `TextField InputProps/inputProps/InputLabelProps` → `slotProps.input/htmlInput/inputLabel`; `Autocomplete renderTags` → `renderValue`; keep `Select inputProps`). Known sites: `components/common/Card.tsx`, `PageHeader.tsx`, `StatCard.tsx`, `components/hermes/HermesEventCard.tsx`, `pages/SettingsPage.tsx`, `pages/HermesActivityPage.tsx`, `components/forms/ProductWizardForm.tsx`, `ProductFields.tsx`, `pages/ProductsPage.tsx`, `components/layout/TopBar.tsx`.
- Test: `tests/visual/publication-journey.spec.ts` — add `page.on('console')` assertion that no message contains `does not recognize the`; Jest snapshot-free checks unchanged.

- [ ] **Step 1:** delete the shim, run `npm run type-check`, list every error (expected 60+).
- [ ] **Step 2:** run `npx @mui/codemod v6.0.0/system-props src/frontend` and `npx @mui/codemod v7.0.0/input-props src/frontend` if available offline; otherwise fix by hand. Convert `renderTags` manually.
- [ ] **Step 3:** `npm run type-check && npm run lint && npm run build` green; `npx playwright test` prints zero unknown-prop console errors (the new assertion passes).
- [ ] **Step 4: Commit** `fix(ui): drop MUI v9 legacy prop shim and migrate call sites`

### Task D2: PRD theme tokens, fonts, shell geometry

**Files:**
- Modify: `src/frontend/theme/themeOptions.ts` (rewrite palette/typography/components from Global Constraints), `src/frontend/index.css` (remove body colour/font rules that fight CssBaseline; keep reset), `src/frontend/main.tsx` (import `@fontsource-variable/manrope` and `@fontsource/jetbrains-mono/400.css`, `/500.css`), `package.json` (add those two deps), `index.html` (pre-hydration script reading `marketdesk.themeMode` to set `data-theme` + background before React), `src/frontend/utils/constants.ts` (`SIDEBAR_WIDTH = 250`), `src/frontend/components/layout/Sidebar.tsx` (lockup: gradient mark + `MarketDesk` + eyebrow `MARKETPLACE OS` beneath; `MENU` eyebrow; active item `primary-weak` bg + primary text; Hermes badge pill danger-weak/danger; account card), `src/frontend/components/layout/TopBar.tsx` (bordered 36px icon buttons radius 10, search with ⌘K hint), `src/frontend/components/common/Badge.tsx` (weak-tint backgrounds + dot; fallback neutral chip for unknown enum), `src/frontend/components/common/StatCard.tsx` (soft icon tile right, tabular value, delta chip).
- Test: `src/frontend/theme/themeOptions.test.ts` (new: palette values equal PRD tokens; `typography.fontFamily` starts with Manrope), existing `TopBar.test.tsx`/`Sidebar` tests updated.

**Interfaces:** theme module augmentation adds `palette.surface2`, `palette.surface3`, `palette.borderStrong`, `palette.textMuted`, and `palette.<semantic>.weak` (`success.weak`, `warning.weak`, `error.weak`, `info.weak`, `primary.weak`); `theme.typography.mono = 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace'` (or export `MONO_FONT` constant) used for SKU/keys.

- [ ] Steps: failing theme test → implement → `npm run build` + Playwright screenshots (`node tmp/shots/app.mjs`) compared visually with companion → commit `feat(ui): apply PRD design tokens, fonts and shell geometry`.

### Task D3: Theme persistence, error boundary, truthful quick actions

**Files:**
- Modify: `src/frontend/components/layout/TopBar.tsx:209` (toggle persists via `useUpdateUserPreferencesMutation` when a principal exists, else local), `src/frontend/components/AuthBootstrap.tsx:43-48,80-84` (apply server preference once per principal; drop the `system` reset), `src/frontend/pages/SettingsPage.tsx:362-365` (no dispatch on mount), `src/frontend/App.tsx` (root `errorElement` + AppShell `errorElement` using a new `components/common/RouteError.tsx` with `Reload` / `Back to dashboard`), `src/frontend/components/layout/AppShell.tsx` (component error boundary around `<Outlet/>`), `src/frontend/pages/dashboardPresentation.ts:13` + test (quick action `Run Hermes` → `Analyze a product` → `/products`), `src/frontend/services/hooks/index.ts:67-72` (type wrappers as `typeof useGetXQuery`).
- Test: `uiSlice.test.ts`, `AuthBootstrap.test.tsx` (new, element-tree style), `dashboardPresentation.test.ts`, `RouteError.test.tsx`.

- [ ] Steps: failing tests `toggle in TopBar persists when authenticated`, `Settings mount does not override the current theme`, `RouteError renders reload action` → implement → verify (`npm run type-check` after removing `any` wrappers; fix surfaced errors) → commit `fix(ui): persist theme, add error boundaries and typed hooks`.

## Lane E — screens (depend on D1; run in parallel per page)

### Task E1: Dashboard per PRD §6

**Files:** `src/frontend/pages/DashboardPage.tsx`, `dashboardPresentation.ts` + tests.
**Interfaces:** KPI row = `Revenue`, `Profit`, `Active listings`, `Needs attention` from `/analytics/overview` (`revenue`, `profit`, `liveListingCount`, attention = `productsByStatus.attention + listingsByStatus.expired + pending critical events`), delta chips only when `previous` has the field; inventory value shown as a caption under Revenue. Layout: KPI row (4 up, `minmax(0,1fr)`), Sales overview (62 %) + Marketplace overview with `MarketplaceBrandChip` (Task E2 produces it; until then use the local chip), Hermes AI activity (latest 4) + Quick actions (`Add product`, `Sync all` → `POST /marketplaces/:id/sync` for connected ones with toast, `Analyze a product` → `/products`, `View analytics`) + Needs attention, Recent events. Empty states: `All clear`, `Connect a marketplace to start`.
- [ ] Steps: failing presentation tests → implement → screenshots → commit `feat(dashboard): PRD command-center layout with truthful KPIs`.

### Task E2: Marketplaces per PRD §12 / issue #174

**Files:**
- Create: `src/frontend/components/marketplaces/MarketplaceBrandChip.tsx`, `MarketplaceSummaryBar.tsx`, `MarketplaceCard.tsx`, `RoadmapMarketplaceCard.tsx`, `MarketplaceConfigureDrawer.tsx`; `src/shared/constants/index.ts` add `MARKETPLACE_BRAND_COLORS: Record<MarketplaceKey, string>` (values from Global Constraints) and `MARKETPLACE_SHORT: Record<MarketplaceKey, string>` (`OL, AL, VI, FB, EB, ET, AM`).
- Modify: `src/frontend/pages/MarketplacesPage.tsx` (rewrite composition), `src/frontend/pages/ListingsPage.tsx` (`status` via `useSearchParams` so `Review sync issues` → `/listings?status=error`).
- Test: `MarketplacesPage.test.tsx` (`renders one OLX card and six roadmap cards`, `roadmap cards expose no connect action`, `sandbox badge shown when marketplace.sandbox`), `MarketplaceBrandChip.test.tsx`.

**Interfaces:** `MarketplaceBrandChip({ marketplaceKey, size?: 'sm'|'md' })` renders the short code on the brand colour tint. Summary bar text: `{connected} of 7 marketplaces connected · {live} active listings · last full sync {relative}` + `Sync all`. OLX card: brand chip, name, status (`Connected`/`Disconnected`, plus `Sandbox` chip when `sandbox`), connection Switch (off → ConfirmDialog → `PATCH {connected:false}`), rows Listings / Synchronization / Errors / Last sync, `Configure` opens the drawer (sync mode select, app credentials form moved here, Disconnect), primary `Connect with OLX` (`Connect sandbox OLX` when `sandbox`). Roadmap cards: muted surface, `Not available yet` chip, one line `Roadmap channel. MarketDesk currently integrates OLX only.`, switch disabled, no button.
- [ ] Steps: failing tests → implement → screenshots light/dark/narrow → commit `feat(marketplaces): channel overview with roadmap cards and sandbox labelling (#174)`.

### Task E3: Hermes AI page per PRD §10

**Files:** `src/frontend/pages/HermesActivityPage.tsx`, `src/frontend/components/hermes/HermesEventCard.tsx:91`, `src/frontend/state/api/hermesApi.ts` (`useGetHermesStatusQuery`, `useGetHermesEventsSummaryQuery`), tests.
**Interfaces:** Banner uses the companion gradient (`linear-gradient(135deg,#5B5BD6,#A24BD6)`), identity `Hermes AI`, status chip from `/hermes/status` (`Hermes connected` success / `Offline heuristics` warning with tooltip `Hermes Agent API is not reachable; suggestions come from built-in heuristics`), sentence `Watching {live} live listings on {connected} marketplace(s)` from `/analytics/overview` + `/marketplaces`, `Configure` → `/settings?section=hermes`. Stat row from `/hermes/events/summary`: `Actions today`, `Awaiting review`, `Completed`, `Dismissed`. Tabs map to server params (`suggestions` → `pending_decision,pending_review`; `alerts` → severity `warning,critical`; `completed` → `applied,dismissed,reverted`), `Load more` using `pagination.total`. Applied card copy uses `marketplaceSync`.
- [ ] Steps: failing tests → implement → commit `feat(hermes): truthful status, summary tiles and server-side filters`.

### Task E4: Products catalogue, wizard, detail (PRD §7, §8, §11; issue #172)

**Files:** `src/frontend/pages/ProductsPage.tsx`, `components/tables/ProductsTable.tsx`, `components/forms/ProductWizardForm.tsx`, `ProductForm.tsx`, `ProductFields.tsx:155-177`, `productFormModel.ts`, `pages/ListingDetailsPage.tsx`, `components/tables/ListingsTable.tsx:313,342,413`, `src/backend/presentation/http/validation/schemas.ts:41` (`costPrice` nullable on create), `src/frontend/utils/formatters.ts` (`formatMoney(1050, 'PLN') === '1 050 zł'`, `formatRelative`).
**Decisions:**
- Catalogue toolbar outside the table card: segmented tabs with count chips, search, `Filters`, `Sort`, list/card toggle; row overflow menu `Open · Edit · Delete` (Delete → ConfirmDialog → `useDeleteProduct`); soft-tint status badges; `Updated` relative; footer `Showing N products` + numbered pagination; initials tile uses a hue derived from the SKU.
- Wizard: step 5 allows `Create as draft` when no marketplace is connected (card `No marketplace connected` + `Connect OLX` link); Review step renders cover, name, condition, description excerpt, `formatMoney` price + profit/margin, category, target marketplace chip; validation details from the API map to step fields (jump to the first failing step).
- Edit form uses `ProductImageUploader` instead of the URL chip field.
- Detail page: two-column hub — left Gallery, Description, Marketplace listings, Price history, Timeline; right Pricing card (draft → primary `Publish to OLX` opening the existing confirm flow; live → `Edit product` + `Open on OLX`), Statistics, Hermes (`Analyze with Hermes`, `Suggest improvements`, readiness check collapsed), Activity. `Delete product` in the hero overflow. Sandbox chip near OLX status when `marketplace.sandbox`.
- Cyrillic strings replaced with `Remove from marketplace and return to draft` / `Remove from marketplace`.
- [ ] Steps: failing tests (`create accepts costPrice null`, `wizard review step shows formatted price and marketplace`, `detail renders Publish to OLX for drafts`, `delete action present`) → implement → screenshots → commit `feat(products): catalogue polish, honest wizard review, detail hub and delete (#172)`.

### Task E5: Settings per PRD §13

**Files:** `src/frontend/pages/SettingsPage.tsx`, `src/backend/presentation/http/controllers/SettingsController.ts:148-188` (Marketplace Accounts merge connection state + handle; `api_keys.available = false`), `src/frontend/theme` density wiring (`ThemeProvider.tsx` reads `density` → `compact` sets `components.MuiButton/MuiTextField/MuiTableCell defaultProps.size = 'small'`), `docs/spec/PRODUCT.md` (record deviations: Security, API keys, Telegram = not available in this release), `docs/spec/TRACEABILITY.md` §13.
**Decisions:** nav items show title only (no subtitles), active = primary-weak + primary text; Security panel = rows Password / Two-factor / Active sessions with disabled actions and `Not available in this release`; API Keys and Telegram = roadmap panels with one explanatory line; Marketplace Accounts shows brand chip, handle, `Connected`/`Disconnected` (+ `Sandbox`) and `Manage` → `/marketplaces`; Hermes section adds caption `Autonomy applies to scheduled catalogue runs, which are disabled in this build; all analyses stay review-only`; Appearance keeps Theme (Light/Dark/System) + Density (now effective); `?section=` query selects the section.
- [ ] Steps: failing tests → implement → commit `feat(settings): honest sections, effective density and account status (#140)`.

### Task E6: Analytics layout per PRD §9

**Files:** `src/frontend/pages/AnalyticsPage.tsx`, `components/charts/*`, `components/tables/AnalyticsTable.tsx`, tests.
**Decisions:** controls condensed to one row (range presets, custom dates, marketplace select, `Export` menu with CSV enabled and PNG disabled with tooltip); KPI deltas labelled `vs previous period`; `Revenue by marketplace` donut from `marketplaceSummary`; Best/Worst as ranked lists; Marketplace comparison as a table with share bar; one consolidated empty state `Not enough data yet — metrics appear after listings collect views and sales` when every series is empty.
- [ ] Steps: failing tests → implement → commit `feat(analytics): companion layout with donut, ranked lists and comparison table`.

## Lane F — docs, onboarding, verification

### Task F1: Tester onboarding docs and truthful README

**Files:** `README.md` (migrations count, stack versions, Quick Start with `env:init`, `Sandbox mode` section), `docs/TESTING_GUIDE.md` (new: account creation, sandbox OLX, what works / known limitations, how to report), `.github/project-status.yml`, `docs/spec/TRACEABILITY.md` rows touched tonight.
- [ ] Steps: write → `npm run verify:spec` → commit `docs: tester guide and truthful README`.

### Task F2: Local test ergonomics

**Files:** `src/backend/infrastructure/jobQueue/__tests__/BullJobQueue.test.ts` (skip cleanly when Redis is unreachable: probe once with 500 ms timeout), `jest.config.js` (silence dotenv banner via `DOTENV_CONFIG_QUIET=true` in `setupFiles`), lint warning cleanup (remove 4 unused eslint-disable directives).
- [ ] Steps: implement → `npx jest --ci` without Redis passes → commit `test: skip redis suite cleanly and quiet dotenv`.

### Task F3: Integration verification (orchestrator)

- [ ] Merge lanes into `feat/mvp-reanimation`; `npm ci`; `npm run type-check && npm run lint && npm run build`; `bash scripts/ci-test.sh` equivalent with the local Compose Postgres/Redis; restart backend; run `node tmp/shots/app.mjs` and the sandbox journey through the real UI with Playwright; compare screenshots with companion; update the vault note; open the PR (draft) with screenshots.
