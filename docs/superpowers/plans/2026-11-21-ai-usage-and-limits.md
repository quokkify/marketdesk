# AI Usage and Hermes Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI call is logged and stored with its tokens; the product page shows what an analysis used; Hermes Activity shows today/7-day AI usage and the provider's limits.

**Architecture:** An AsyncLocalStorage scope (`aiUsageScope`) carries `{workspaceId, feature, productId, analysisId}` from the application call sites to the single Hermes egress (`HermesCompletionClient`), which parses `usage` and emits one `AiCallRecord` per exit path to a sink (pino line + `ai_usage` row). Limits come from a JSON file written on the host by `hermes usage --json` and read through a read-only mount.

**Tech Stack:** Express, pg, zod, pino, RTK Query, React + MUI; q4j (TestNG, RestAssured, Selenide) in `test-automation`.

**Spec:** `docs/superpowers/specs/2026-11-21-ai-usage-and-limits-design.md`

## Global Constraints

- Tests: live q4j tests in `test-automation` against the branch Compose stack; no new Jest tests that use mocks (pure-function Jest tests are allowed).
- Log message verbatim: `AI call`; `warn` when outcome is not `ok`. Never log or store prompt or response text.
- `provider`: `hermes` | `offline`. `outcome`: `ok` | `unavailable` | `rejected` | `invalid_output`. `cost_status`: `included` | `not_applicable` | `unknown`.
- `HERMES_BILLING_MODE=subscription_included` → `included`; unset → `unknown`; offline rows → `not_applicable`.
- Unknown is never 0: tokens NULL when not reported; UI text `usage not reported` / `no AI usage`.
- Per-analysis copy verbatim: `Hermes · {in} in / {out} out tokens · included in subscription`, `Hermes · usage not reported`, `Offline heuristics · no AI usage`.
- Limits states: `fresh` | `stale` | `unknown` | `not_configured`; stale when `fetched_at` is older than 15 minutes; `details` lines containing `/usage reset` are dropped; caption `account-wide, shared with all Hermes use`.
- Day boundaries in the workspace timezone (`Workspace.timezone`).
- Migration `045_ai_usage.sql`, replay-safe (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, no DROP).
- Public repo: no secrets, internal URLs or machine paths.

## Review Focus

1. Hermes returns `usage` with negative, fractional or string values → stored as NULL, not as garbage or 0.
2. Recording fails (DB down) → the analysis still succeeds; a `warn` names the failure.
3. An AI call outside any scope (a future call site) → logged with `warn` "unattributed AI call", not silently dropped, no crash.
4. The limits file is half-written, empty, has `unavailable_reason`, or a `fetched_at` in the future → `unknown` (future treated as unknown), never old numbers shown as fresh.
5. Two workspaces → each sees only its own usage totals; limits are the same for both (account-wide).

---

### Task 1: Capture, attribution, log line, per-analysis totals in the API

**Files:**
- Create: `src/backend/application/ai/aiUsageScope.ts`, `src/backend/application/ai/AiCallRecord.ts`, `src/backend/application/ai/parseUsage.ts` (+ `parseUsage.test.ts`, pure)
- Modify: `src/backend/infrastructure/external/HermesCompletionClient.ts`, `HermesAI.ts`, `AIProviderSelector.ts`, `src/backend/application/services/ProductAssistanceGraph.ts`, `ProductAIDraftService.ts`, `src/backend/application/usecases/RunHermesUseCase.ts`, `src/backend/config/di/container.ts`, `src/shared/types/index.ts`
- Test: `test-automation/.../test/api/AiUsageTest.java` (+ service/steps/verification/model as the project layout requires)

**Interfaces (produces):**
- `AiCallRecord = { workspaceId?: string; analysisId?: string; feature?: string; productId?: string; operation: string; provider: 'hermes'|'offline'; model: string|null; promptTokens: number|null; completionTokens: number|null; totalTokens: number|null; latencyMs: number; outcome: 'ok'|'unavailable'|'rejected'|'invalid_output'; httpStatus: number|null; runId?: string; costStatus: 'included'|'not_applicable'|'unknown'; createdAt: Date }`
- `interface AiUsageSink { record(r: AiCallRecord): void }` (fire-and-forget; implementations never throw)
- `withAiUsageScope<T>(scope: { workspaceId: string; feature: string; productId?: string }, fn: () => Promise<T>): Promise<{ value: T; usage: AiUsageSummary }>` — creates `analysisId`, collects records made inside.
- `withAiOperation<T>(operation: string, fn: () => Promise<T>): Promise<T>` — used by `HermesAI` methods and the offline record.
- `AiUsageSummary = { provider: 'hermes'|'offline'|'none'; calls: number; promptTokens: number|null; completionTokens: number|null; totalTokens: number|null; costStatus: AiCallRecord['costStatus'] }` (token sums are NULL if any hermes call reported NULL)
- `parseUsage(body: unknown): { promptTokens: number|null; completionTokens: number|null; totalTokens: number|null }` — non-negative safe integers only.
- Shared type: optional `aiUsage?: AiUsageSummary` on `ProductImprovementSuggestions` and `ProductAIDraft`.

- [ ] **Step 1: Failing tests.** `parseUsage.test.ts`: `{usage:{prompt_tokens:1840,completion_tokens:412,total_tokens:2252}}` → 1840/412/2252; missing usage → all null; `{prompt_tokens:-1, completion_tokens:1.5, total_tokens:'9'}` → all null. q4j `AiUsageTest.improvementReportsOfflineUsage`: register, connect sandbox OLX, create product (+ listing), `POST /api/products/{id}/improvements` → `data.aiUsage.provider == "offline"`, `data.aiUsage.totalTokens == null`, `data.aiUsage.costStatus == "not_applicable"`.
- [ ] **Step 2: Run** `npx jest src/backend/application/ai` → FAIL (module missing); on a fresh branch stack `./gradlew apiTest --tests '*AiUsageTest'` → FAIL (`aiUsage` absent).
- [ ] **Step 3: Implement.** Client measures latency around `fetch`, emits a record on ok / non-2xx (`rejected` for 4xx, `unavailable` for 5xx/timeout/transport) / invalid body (`invalid_output`); `complete()` still returns the text. `HermesAI` wraps each method in `withAiOperation('<methodName>')`. Selector emits one offline record per IAIProvider call when it resolves to offline inside a scope. Scopes: `improve` around the improve node (`ProductAssistanceGraph.proposeImprovements`), `draft` around `ProductAIDraftService` enrichment, `autopilot` around `RunHermesUseCase` engine calls (operation distinguishes seo/price/title). Container: a logging sink (pino `AI call`, fields under `ai`) composed with the DB sink from Task 2 (for now logging only). Unattributed record → `warn` `unattributed AI call`.
- [ ] **Step 4: Run** the same commands → PASS; `npm run type-check && npx eslint src/backend` clean.
- [ ] **Step 5: Commit** `feat(ai): record tokens of every AI call and return them with each analysis`.

### Task 2: `ai_usage` table and `GET /api/hermes/usage`

**Files:** Create `src/backend/persistence/migrations/045_ai_usage.sql`, `src/backend/infrastructure/persistence/repositories/AiUsageRepository.ts`; modify container, `HermesController.ts`, `routes/hermes.ts`; q4j additions in `AiUsageTest`.

**Interfaces:**
- Table columns: `id uuid pk, workspace_id uuid not null → workspaces on delete cascade, analysis_id uuid, run_id varchar(128), feature varchar(64) not null, operation varchar(64) not null, product_id uuid → products on delete set null, provider varchar(16) not null, model varchar(128), prompt_tokens int, completion_tokens int, total_tokens int, cost_status varchar(16) not null, latency_ms int not null, outcome varchar(16) not null, http_status smallint, created_at timestamptz not null default now()`; index `(workspace_id, created_at desc)`.
- `AiUsageRepository.insert(r: AiCallRecord): Promise<void>`; `summary(workspaceId, timezone, now): Promise<AiUsageReport>`
- `AiUsageReport = { timezone: string; today: AiUsageTotals; last7Days: AiUsageTotals; byFeature: Array<{ feature: string; analyses: number; totalTokens: number|null }>; costStatus: 'included'|'mixed'|'unknown'|'not_applicable' }`, `AiUsageTotals = { analyses; hermesAnalyses; offlineAnalyses; failedAnalyses; promptTokens; completionTokens; totalTokens }` (analyses = distinct `analysis_id`; token sums over non-null).
- `GET /api/hermes/usage` → `AiUsageReport` for `req.user.workspaceId`.

- [ ] **Step 1: Failing q4j tests:** `usageCountsAnOfflineAnalysisToday` (one improvement → `today.analyses == 1`, `offlineAnalyses == 1`, `today.totalTokens == null`, because offline calls report no tokens); `usageIsScopedToTheWorkspace` (second account → `today.analyses == 0`); `usageRequiresLogin` (401).
- [ ] **Step 2: Run** → FAIL (404 route).
- [ ] **Step 3: Implement** migration, repository (parameterised SQL, timezone via `AT TIME ZONE $tz`), DB sink wrapped in `ignoringFault` + `warn`, endpoint.
- [ ] **Step 4: Run** q4j `AiUsageTest` + full `npm test` (SKIP_REDIS_TESTS=true) → PASS.
- [ ] **Step 5: Commit** `feat(ai): store AI calls and report today's and this week's usage`.

### Task 3: Limits file reader and `GET /api/hermes/limits`

**Files:** Create `src/backend/infrastructure/external/HermesLimitsReader.ts`; modify container, `HermesController.ts`, `routes/hermes.ts`, `docker-compose.yml` (app volume `${HERMES_USAGE_DIR:-./hermes-usage}:/app/hermes-usage:ro`), `.env.example` (`HERMES_USAGE_FILE=/app/hermes-usage/usage.json`, `HERMES_BILLING_MODE=` with a comment), `scripts/ci-java-api-tests.sh` (`mkdir -p hermes-usage` before `compose up`), `.gitignore` (`hermes-usage/`); q4j `HermesLimitsTest` (`@SingleThread`, writes fixtures into the host dir, config key `MARKETDESK_HERMES_USAGE_DIR`, default `../hermes-usage`).

**Interfaces:**
- File schema (from `hermes usage --json`): `{ provider, source, title, plan, fetched_at, windows: [{ label, used_percent, resets_at, detail }], details: string[], unavailable_reason: string|null }`.
- `HermesLimits = { state: 'fresh'|'stale'|'unknown'|'not_configured'; scope: 'account'; provider: string|null; plan: string|null; fetchedAt: string|null; ageSeconds: number|null; windows: Array<{ label: string; usedPercent: number|null; resetsAt: string|null }>; details: string[]; reason: string|null }`
- `HermesLimitsReader.read(now: Date): Promise<HermesLimits>` — reads on every call (no cache); env unset → `not_configured`; missing/unparseable/`unavailable_reason`/future `fetched_at` → `unknown`; older than 15 min → `stale` (values kept).

- [ ] **Step 1: Failing q4j tests:** `freshLimitsShowPlanAndWindows` (fixture with `fetched_at` = now → `state fresh`, `plan Plus`, windows `Session 4.0`, `Weekly 10.0`, no `/usage reset` in `details`); `oldLimitsAreStale` (now − 20 min → `stale`, values present); `brokenFileIsUnknown` (`{"provider":` → `unknown`); `missingFileIsUnknown`; `unavailableReasonIsUnknown`; `limitsRequireLogin` (401).
- [ ] **Step 2: Run** → FAIL (404).
- [ ] **Step 3: Implement** reader (zod), endpoint, compose/env/CI changes.
- [ ] **Step 4: Run** `./gradlew apiTest` (full) → PASS.
- [ ] **Step 5: Commit** `feat(ai): show the AI provider's limits read from Hermes`.

### Task 4: Frontend

**Files:** Modify `src/frontend/state/api/hermesApi.ts` (+ hooks), `src/frontend/pages/HermesActivityPage.tsx`, `src/frontend/pages/ListingDetailsPage.tsx` (improvements result), `src/frontend/components/product-detail/ProductDetailSections.tsx` if the result renders there; create `src/frontend/components/hermes/HermesLimitsCard.tsx`, `AiUsageCard.tsx`, `src/frontend/components/hermes/aiUsageText.ts` (pure copy helpers); q4j page objects + `AiUsageUiTest`.

**Interfaces:** `aiUsageLine(usage: AiUsageSummary | undefined): string` (exact copy from Global Constraints); `limitsView(l: HermesLimits): { bars: Array<{ label; percent; resetsAt; tone: 'ok'|'warning'|'error' }>; note: string }` (warning ≥ 80, error ≥ 100; stale note `checked N min ago — may be out of date`; unknown/not_configured `Limits unavailable` + reason).

- [ ] **Step 1: Failing q4j UI tests** (stack with a fresh fixture): `hermesActivityShowsLimitsAndUsage` (page shows `Plus`, `Session`, `10%`, `account-wide, shared with all Hermes use`, and the usage card shows `1` analysis after an improvement); `productPageShowsOfflineUsageLine` (Suggest improvements → `Offline heuristics · no AI usage`).
- [ ] **Step 2: Run** `./gradlew uiTest --tests '*AiUsageUiTest'` → FAIL.
- [ ] **Step 3: Implement** cards, line, RTK queries (`getHermesUsage`, `getHermesLimits`, refetch every 60 s on the Hermes page).
- [ ] **Step 4: Run** `./gradlew apiTest uiTest`, `npm test`, type-check, lint, build → green.
- [ ] **Step 5: Commit** `feat(ai): show AI usage and Hermes limits on the Hermes page and per analysis`.

### Deploy checklist (production, after merge)

- [ ] `mkdir -p ~/projects/marketdesk-deploy/hermes-usage`; systemd user service + timer (every 5 min) running `hermes -p marketdesk usage --json > usage.json.tmp && mv usage.json.tmp usage.json`, writing `{"unavailable_reason":"fetch failed","fetched_at":"<now>"}` on failure; `OnFailure` Telegram like the backup unit.
- [ ] `.env`: `HERMES_USAGE_FILE=/app/hermes-usage/usage.json`, `HERMES_BILLING_MODE=subscription_included`; new compose file from the merged commit; new image tag.
- [ ] Verify: `/api/hermes/limits` → `fresh`; run one analysis → `AI call` line with real tokens; usage card shows it.
