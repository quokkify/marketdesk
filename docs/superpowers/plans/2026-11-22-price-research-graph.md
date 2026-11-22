# Price Research Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price research runs as a LangGraph graph (identify → four tier nodes → code class/price checks → locked merge) in a background Bull job, the estimate accounts for missing accessories, and the page and the future autopilot see run state and a readiness verdict.

**Architecture:** `PriceResearchGraph` (application service, pattern of `ProductAssistanceGraph`/`ConversationReplyGraph`) makes five narrow calls to the web-only research profile and filters results in code. `PriceResearchRuns` owns triggers, dedupe, leases and outcome-based freshness in a new `price_research_runs` table and enqueues the `price-research` Bull job, whose handler runs the graph and then an estimate-only use case extracted from `HermesDecisionEngine`. The frontend polls the research GET while a run is active.

**Tech Stack:** TypeScript, Express, PostgreSQL, Bull/Redis, `@langchain/langgraph`, zod, React + RTK Query; Jest for pure functions and graph orchestration with testkit doubles; q4j (Java 21) for live API/UI.

**Spec:** `docs/superpowers/specs/2026-11-22-price-research-graph-design.md` (builds on `2026-11-22-price-anchor-ladder-design.md`).

## Global Constraints

- Class rule: `equal` attributes must match; `ratio` attributes within ×0.5–×2 of the item's value; a missing or unknown attribute drops the substitute. Same-model rows skip the check. Item with no class attributes → substitutes kept with `classChecked: false`, excluded from the substitute ceiling and tier confidence.
- Host rule: `last_new_price` and `substitute_new` accept the existing allowlist or any host ending in `.pl`, minus a denylist of non-shops; `same_model_used` and `substitute_used` accept only OLX advert or Allegro Lokalnie offer URLs. Search-result pages are never stored.
- priceSanity: drop non-PLN rows; drop a `last_new_price` more than 3× the median of kept `substitute_new` prices, or, with none kept, of all other kept rows.
- Execution: never inside an HTTP request. Queue `price-research`, queue concurrency 1, process-wide limiter **3** concurrent research calls (`HERMES_RESEARCH_MAX_CONCURRENCY`, default 3), at most 10 queued runs per workspace (`429` beyond), `attempts: 1`.
- Limits: `main` has no per-workspace AI usage limit check (it lives on an unmerged branch); v1 relies on `aiLimiter` on the route and the 10-queued-runs cap. When the limits branch lands, `request` calls its check before enqueuing.
- Budgets: 180 s per node (`DEFAULT_HERMES_RESEARCH_TIMEOUT_MS` becomes `180_000`), 7 min per run, lease 10 min; identify gets one in-run retry; tier nodes none.
- Outcomes: identify fails after retry → `failed`; a tier fails → `partial` (that tier's stored rows untouched); all tiers fail → `failed`; `partial` without any class-checked substitute rows → `failed`.
- Freshness by outcome: `ok` → `next_auto_at = finished + 7 d`; `partial` → +24 h; `failed` → +1 h doubling per consecutive failure, cap 24 h; not configured / not PLN / unsafe toolset → no run recorded. Find prices ignores `next_auto_at`.
- Run-state writes never touch `product_price_research.updated_at`. The ladder save is one transaction with `SELECT … FOR UPDATE`, merging into rows and dismissals read inside it; the seller PUT takes the same lock.
- `saveEstimate` writes only when the new estimate's `researchUpdatedAt` is not older than the stored one's.
- `missingAccessories`: optional, trimmed, max 200 chars; reaches only the price estimate prompt (no-tools profile, inside `sellerDataBlock`), never any research prompt.
- Toolset check (`isResearchToolsetSafe`) before every Hermes call in the graph. AI usage per call under feature `research`, operation `research.<node>`.
- Migrations replay on every start: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, never `DROP`; mirror in `schema.sql`.
- Tests: pure functions in Jest; graph and runs orchestration in Jest with testkit doubles (in-memory repos and a scripted research client, no `jest.mock`); behaviour through the running app in q4j (CI stand has no research profile: `503` paths, run state, completeness, UI states). Real research is checked by hand on prod with the QH11 case.
- Copy (exact): progress `Identifying the model…`, `Searching prices: {done} of 4`, `Saving…`; last run `Prices searched {when}`, `Prices searched {when}; {tier list} search failed, will retry {when}`, `Price search failed: {reason}. Will retry {when}`; dirty editor `New prices found. Reload to see them.`; estimate pending `Searching prices, about 2–4 min. The estimate appears when it finishes.`; form label `Missing accessories`, hint `For example: remote, charger. Used only to price the item.`

## Review Focus

1. A second Find prices click (or Analyze) while a run is queued or running → the same run is returned, no second graph (Task 5 test `request returns the active run`).
2. A worker dies mid-run → after the 10 min lease the product can run again and the stale run reads `failed` (Task 5 test `expired lease frees the product`).
3. The seller deletes or edits a row while a run is in flight → the run's save keeps the deletion and the edit (Task 4 test `save merges into rows read under lock`).
4. Analyze runs during a research job and finishes after it → the older estimate does not overwrite the job's newer one (Task 6 test `older researchUpdatedAt does not overwrite`).
5. An item whose identify returns no class attributes (unbranded) → substitutes are stored as unchecked, no substitute ceiling, confidence low, no crash (Task 1 test `unknown item class keeps rows unchecked`, Task 6 test `unchecked substitutes do not feed the ceiling`).

---

### Task 1: Class attributes, tier-aware hosts and price sanity (pure)

**Files:**
- Create: `src/backend/domain/services/classMatch.ts`, `src/backend/domain/services/__tests__/classMatch.test.ts`
- Create: `src/backend/domain/services/priceSanity.ts`, `src/backend/domain/services/__tests__/priceSanity.test.ts`
- Modify: `src/shared/types/index.ts` (`PriceComparable`), `src/shared/anchorUrl.ts`, `src/shared/__tests__/anchorUrl.test.ts`
- Modify: `src/backend/infrastructure/external/anchorLadderPrompt.ts` (`filterAnchorRows` uses the tier-aware check)

**Interfaces:**
- Produces (shared):
  ```ts
  export interface ClassAttribute { name: string; value: string | number; unit?: string | null; match: 'equal' | 'ratio' }
  // PriceComparable gains: classAttributes?: ClassAttribute[] | null; classChecked?: boolean | null
  ```
- Produces: `matchesClass(item: readonly ClassAttribute[], candidate: readonly ClassAttribute[] | null | undefined): boolean` and `applyClassFilter(rows: PriceComparable[], item: readonly ClassAttribute[]): PriceComparable[]` (sets `classChecked`, drops mismatches; same-model and last-new-price rows pass untouched; empty `item` → substitutes kept with `classChecked: false`).
- Produces: `applyPriceSanity(rows: PriceComparable[], currency: string): PriceComparable[]`.
- Produces: `normalizeAnchorUrlForTier(url: string, tier: AnchorTier): string | null` and `NON_SHOP_HOSTS: readonly string[]` (initial: `e-katalog.pl`, `keenable.ai`, `google.com`, `bing.com`, `duckduckgo.com`). `normalizeAnchorUrl` stays for the PUT path of manual/web rows.

- [ ] **Step 1: Failing tests.** `classMatch`: 720p `equal` + 200 lm `ratio` item vs 720p/140 → true; vs 720p/2500 → false; vs 1080p/200 → false; vs 720p/100 → true (×0.5 inclusive), 720p/400 → true (×2 inclusive), 720p/99 → false; candidate missing lumens → false; string compare for `equal` is case- and space-insensitive (`1280x720` vs `1280 × 720` normalized by removing spaces, `×`→`x`). `applyClassFilter`: BenQ W600 row (720p/2500) dropped; `unknown item class keeps rows unchecked`. `priceSanity`: EUR row dropped; `last_new_price` 2594 with new substitutes 273/360 → dropped; 799 kept; with no new substitutes compare with median of other rows. `anchorUrl`: `https://tst.pl/produkty/x` ok for `substitute_new`, null for `substitute_used`; `https://e-katalog.pl/x` null for every tier; `https://www.olx.pl/oferty/q-aopen-qh11/` null for every tier; OLX advert ok for `same_model_used`.
- [ ] **Step 2: Run** `npx jest classMatch priceSanity anchorUrl` — FAIL.
- [ ] **Step 3: Implement**; `filterAnchorRows` calls `normalizeAnchorUrlForTier`.
- [ ] **Step 4: Run** the same — PASS; `npm run type-check` clean.
- [ ] **Step 5: Commit** `feat(pricing): check substitute class and price sanity in code`

### Task 2: Missing accessories field

**Files:**
- Create: `src/backend/persistence/migrations/052_product_missing_accessories.sql`; Modify: `schema.sql`
- Modify: `src/backend/domain/entities/Product.ts`, `src/backend/infrastructure/persistence/repositories/ProductRepository.ts`, `src/backend/presentation/http/validation/schemas.ts:50,70`, the product create/update use cases and DTOs that carry `minAcceptablePrice` (follow it)
- Modify: `src/backend/infrastructure/external/priceEstimatePrompt.ts` and its test
- Modify: `src/frontend/components/forms/productFormModel.ts`, `ProductFields.tsx`, `productWizardDraft.ts` (if it lists fields), their tests
- Test (q4j): `test-automation/.../test/api/ProductTest.java` (or the existing product API test class) and `ProductRequestPojo`

**Interfaces:**
- Produces: `Product.missingAccessories: string | null` (create/update props `missingAccessories?: string | null`), column `products.missing_accessories VARCHAR(200)`, API field `missingAccessories` on product create/update/read.

- [ ] **Step 1: Failing tests.** Jest: entity trims, empty → null, 201 chars → `ValidationError`; `buildPriceEstimatePrompt` puts `missingAccessories` inside the `<seller_data>` block and adds the rule line `If missing accessories are listed, lower the price for them and name the deduction in reasoning.`; `buildAnchorLadderPrompt` and the Task 3 prompts never contain it (assert on a product with `missingAccessories: 'pilot'`). Frontend model: field round-trips form ↔ body, 201 chars → error.
- [ ] **Step 2: Run** focused Jest — FAIL.
- [ ] **Step 3: Implement**; migration `ALTER TABLE products ADD COLUMN IF NOT EXISTS missing_accessories VARCHAR(200)`; form field with the exact label and hint.
- [ ] **Step 4: Run** focused Jest, `npm run type-check`, full `SKIP_REDIS_TESTS=true npm run test:ci` — PASS.
- [ ] **Step 5: q4j** `productStoresMissingAccessories` (create with `"pilot"`, GET returns it), `missingAccessoriesTooLongIs400`. `compileTestJava`.
- [ ] **Step 6: Commit** `feat(products): record missing accessories for pricing`

### Task 3: Node prompts and parsers

**Files:**
- Create: `src/backend/infrastructure/external/priceResearchPrompts.ts`, `src/backend/infrastructure/external/__tests__/priceResearchPrompts.test.ts`
- Modify: `src/backend/infrastructure/external/anchorLadderPrompt.ts` (keep `sanitizeSearchName`, `isResearchToolsetSafe`, `filterAnchorRows`, `parseJsonObject` use; delete `buildAnchorLadderPrompt`/`parseAnchorLadder` once Task 4 stops using them — in Task 4)

**Interfaces:**
- Produces:
  ```ts
  export type ResearchNode = 'identify' | 'sameModelUsed' | 'lastNewPrice' | 'substitutesNew' | 'substitutesUsed';
  export interface Identification { model: string; specs: string; classAttributes: ClassAttribute[]; successors: string[]; sameClassModels: { model: string; classAttributes: ClassAttribute[]; url: string }[] }
  export function buildIdentifyPrompt(item: { name: string; condition: string; category: string; currency: string }): { system: string; prompt: string };
  export function parseIdentification(raw: string): Identification | null; // zod; specs ≤ 300 chars; ≤ 8 attributes; ≤ 5 successors; ≤ 5 same-class models
  export function buildTierPrompt(node: Exclude<ResearchNode, 'identify'>, item: {...same as above}, ident: Identification): { system: string; prompt: string };
  export function parseTierAnchors(raw: string): unknown[] | null; // array under "anchors"; each item may carry classAttributes
  ```
- Prompt content pinned by the spike (variant A): identify asks for native resolution style attributes "that decide the class", marketing claims ignored, successors of the same line, 3–5 same-class models with a source URL each. Tier prompts: only models from `ident` count; sources OLX search pages `https://www.olx.pl/oferty/q-<words>/`, Allegro Lokalnie search, Ceneo, big shop category pages (mediamarkt.pl); skip allegro.pl, mediaexpert.pl, kaufland.pl, alza; `substitutesNew` includes new items from private OLX sellers (sealed / with receipt); every offer reports its own `classAttributes`; at most `MAX_ANCHORS_PER_TIER` offers; strict JSON only. Every prompt states the `<seller_data>` and "never invent" rules and contains only sanitized name, condition, category, currency.

- [ ] **Step 1: Failing tests.** Each prompt contains its tier name and the skip-hosts line; tier prompts embed the identification models; no prompt contains the product description or `missingAccessories`; empty sanitized name throws `SEARCH_NAME_TOO_SHORT`; `parseIdentification` accepts the spike's identify JSON shape and rejects missing `classAttributes`; `parseTierAnchors` accepts an object with `anchors`, rejects garbage.
- [ ] **Step 2–4:** run FAIL → implement → PASS (`npx jest priceResearchPrompts`).
- [ ] **Step 5: Commit** `feat(pricing): prompts for the price research graph nodes`

### Task 4: PriceResearchGraph and the locked ladder save

**Files:**
- Create: `src/backend/application/services/PriceResearchGraph.ts`, `src/backend/application/services/__tests__/PriceResearchGraph.test.ts`
- Create: `src/backend/application/services/researchCallLimiter.ts` (process-wide semaphore)
- Modify: `src/backend/infrastructure/external/HermesAI.ts` (`AICompletionRequest.signal?: AbortSignal` passed to `fetch`; `DEFAULT_HERMES_RESEARCH_TIMEOUT_MS = 180_000`; env `HERMES_RESEARCH_MAX_CONCURRENCY`)
- Modify: `IPriceResearchRepository` + `PriceResearchRepository` (`saveLadderLocked`), `PUT` path takes the same lock; `src/backend/domain/testkit/support.ts` (in-memory repo)
- Modify: `src/backend/application/services/AnchorLadderService.ts` — `runResearch` delegates to the graph for this task only (keeps route and engine working); Task 5 deletes the service
- Delete: `buildAnchorLadderPrompt`/`parseAnchorLadder` and their tests

**Interfaces:**
- Consumes: Task 1 `applyClassFilter`, `applyPriceSanity`; Task 3 prompts/parsers; existing `filterAnchorRows`, `mergeLadder`, `isResearchToolsetSafe`, `ComparableResearchProfile` (move into `PriceResearchGraph.ts`), `SEARCH_NOT_CONFIGURED`, `SEARCH_NEEDS_PLN`, `SEARCH_UNUSABLE` (move into `PriceResearchGraph.ts`, same text).
- Produces:
  ```ts
  export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'timeout';
  export type RunOutcome = 'ok' | 'partial' | 'failed';
  export interface GraphResult { outcome: RunOutcome; nodes: Record<ResearchNode, NodeStatus>; failedTiers: AnchorTier[]; errorCode: string | null; research: PriceResearch | null; rowsChanged: boolean }
  export class PriceResearchGraph {
    constructor(deps: { products; listings; research: IPriceResearchRepository; profile: ComparableResearchProfile | null; limiter: ResearchCallLimiter; now: () => Date; logger? });
    run(input: { workspaceId: string; productId: string; signal: AbortSignal; onNode: (node: ResearchNode, status: NodeStatus) => Promise<void> }): Promise<GraphResult>;
  }
  export function createResearchCallLimiter(max: number): ResearchCallLimiter; // run<T>(fn: () => Promise<T>): Promise<T>
  // repository:
  saveLadderLocked(workspaceId: string, productId: string, apply: (current: PriceResearch | null) => { comparables: PriceComparable[]; specs: string | null } | null): Promise<PriceResearch | null>; // BEGIN; SELECT … FOR UPDATE; apply; UPDATE … updated_at = NOW_UTC; COMMIT; null from apply → no write
  ```
- Graph: LangGraph `StateGraph` with nodes `identify` → (`sameModelUsed`, `lastNewPrice`, `substitutesNew`, `substitutesUsed` in parallel) → `filter` (Task 1 functions + `filterAnchorRows` with dismissals read inside the lock) → `save` (`saveLadderLocked`, merging only the tiers that succeeded; failed tiers' stored rows untouched). Not configured → `ServiceUnavailableError(SEARCH_NOT_CONFIGURED)`; not PLN → `ValidationError(SEARCH_NEEDS_PLN)` (both thrown before any call). Toolset check before every call; usage `withAiUsageScope({feature:'research'})` + `withAiOperation('research.<node>')`.

- [ ] **Step 1: Failing tests** (testkit in-memory repos, scripted research client returning canned JSON per prompt kind): `ok` run stores class-checked rows and drops the BenQ row; identify fails once then succeeds (retry) → `ok`; identify fails twice → `failed`, nothing saved; one tier throws → `partial`, `failedTiers` names it, its previously stored rows remain; only `lastNewPrice` succeeds → `failed` (no substitutes); unsafe toolset before a tier call → that tier `failed`; `save merges into rows read under lock` (repo changes the stored rows between filter and save → manual edit and dismissal survive); run budget abort → outcome from finished nodes, unfinished nodes `timeout`; limiter never runs more than 3 client calls at once (scripted client records concurrency).
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx jest PriceResearchGraph researchCallLimiter`).
- [ ] **Step 5:** `AnchorLadderService.runResearch` calls `graph.run` with a 7 min signal and a no-op `onNode`, mapping `failed` to the existing errors; `npm run type-check`, full Jest — PASS.
- [ ] **Step 6: Commit** `feat(pricing): research prices with a graph of narrow Hermes calls`

### Task 5: Runs table, request service and the price-research job

**Files:**
- Create: `src/backend/persistence/migrations/053_price_research_runs.sql`; Modify: `schema.sql`
- Create: `src/backend/domain/repositories/interfaces/IPriceResearchRunRepository.ts`, `src/backend/infrastructure/persistence/repositories/PriceResearchRunRepository.ts`
- Create: `src/backend/domain/services/researchSchedule.ts` + test
- Create: `src/backend/application/services/PriceResearchRuns.ts` + test
- Create: `src/backend/infrastructure/jobQueue/JobHandlers/PriceResearchHandler.ts`
- Modify: `src/backend/application/ports/IJobQueue.ts` (`PriceResearchJob`), `src/backend/config/di/container.ts` (queue, handler, wiring), `src/backend/domain/shared/DomainError.ts` (`TooManyRequestsError`, mapped to `429` in `ErrorHandlingMiddleware`)
- Replace: `src/backend/domain/ports/IPriceResearchRefresher.ts` → `IPriceResearchRuns.ts`; the engine calls `runs.request(force: false, trigger: 'analyze')` instead of `refreshIfStale` (no wait)
- Delete: `src/backend/application/services/AnchorLadderService.ts` and its tests (the graph and `PriceResearchRuns` replace it)
- Test (q4j): `PriceResearchRefreshTest.java`

**Interfaces:**
- Table: `price_research_runs(id UUID PK, workspace_id UUID NOT NULL, product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, trigger VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL, nodes JSONB NOT NULL DEFAULT '{}', outcome VARCHAR(20), failed_tiers JSONB NOT NULL DEFAULT '[]', error_code VARCHAR(60), consecutive_failures INT NOT NULL DEFAULT 0, queued_at TIMESTAMP NOT NULL, started_at TIMESTAMP, finished_at TIMESTAMP, lease_until TIMESTAMP, next_auto_at TIMESTAMP)`, index `(product_id, queued_at DESC)`, partial unique index on `product_id WHERE status IN ('queued','running')`.
- Produces:
  ```ts
  export type RunStatus = 'queued' | 'running' | 'finished';
  export type RunTrigger = 'manual' | 'analyze' | 'autopilot';
  export interface ResearchRun { id; workspaceId; productId; trigger: RunTrigger; status: RunStatus; nodes: Partial<Record<ResearchNode, NodeStatus>>; outcome: RunOutcome | null; failedTiers: AnchorTier[]; errorCode: string | null; queuedAt; startedAt; finishedAt; nextAutoAt: string | null }
  export function nextAutoAt(outcome: RunOutcome, consecutiveFailures: number, finishedAt: Date): Date; // 7 d / 24 h / 1 h·2^(n-1) capped 24 h
  export interface IPriceResearchRuns {
    request(workspaceId: string, productId: string, opts: { force: boolean; trigger: RunTrigger }): Promise<{ run: ResearchRun | null; enqueued: boolean; reason: 'enqueued' | 'active' | 'not_due' | 'not_configured' | 'not_pln' }>;
    latest(workspaceId: string, productId: string): Promise<{ active: ResearchRun | null; last: ResearchRun | null }>;
  }
  export interface PriceResearchJob { workspaceId: string; productId: string; runId: string }
  ```
- `request`: 404 for another workspace's product; not configured / not PLN → `reason` without a row (the route maps them to `503`/`422`); active run (status queued/running and lease not expired) → `active`; `force: false` and `now < last.next_auto_at` → `not_due`; more than 10 queued runs in the workspace → `TooManyRequestsError` (`429`); otherwise insert `queued` and enqueue `{workspaceId, productId, runId}`.
- Handler: claim `running` where `id = runId AND status = 'queued'` (no match → exit), set `lease_until = now + 10 min`, run the graph with a 7 min `AbortSignal` and `onNode` writing `nodes`, then finish (`outcome`, `failed_tiers`, `error_code`, `consecutive_failures`, `next_auto_at`), then call the estimate use case (Task 6) when `rowsChanged` or no estimate exists, then publish `{ type: 'price_research.completed', aggregateType: 'product', aggregateId: productId, payload: { runId, outcome }, occurredAt }`. Expired lease: `request` and `latest` treat a `running` row with `lease_until < now` as finished `failed` (`error_code: 'lease_expired'`) and write that.

- [ ] **Step 1: Failing tests.** `researchSchedule`: ok → +7 d; partial → +24 h; failed with 1/2/3/6 consecutive → +1/2/4/24 h (cap). `PriceResearchRuns` (in-memory run repo + recording queue): `request returns the active run`; `expired lease frees the product`; `not_due` respected unless `force`; 11th queued run in a workspace → 429; not configured/not PLN create no row. Handler: claim mismatch exits without graph; finish writes outcome and `next_auto_at`; publishes the event.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** wire DI: `createQueue<PriceResearchJob>('price-research')`, handler registered, queue added to `queues`. Route `POST …/price-research/refresh` → `request(force: true, trigger: 'manual')` → `202 { run }` (`200` when `active`), `503`/`422` mapped. `npm run type-check`, full Jest.
- [ ] **Step 6: q4j** `PriceResearchRefreshTest`: keep `refreshWithoutResearchProfileIsNotConfigured` (503), `otherWorkspaceRefreshIs404`, `refreshRequiresLogin`; add `notConfiguredCreatesNoRun` (GET shows `run: null`, `lastRun: null`). `compileTestJava`.
- [ ] **Step 7: Commit** `feat(pricing): run price research as a background job with outcome-based retries`

### Task 6: Estimate-only use case, engine changes, readiness

**Files:**
- Create: `src/backend/application/services/PriceEstimateService.ts` + test
- Create: `src/backend/domain/services/priceReadiness.ts` + test
- Modify: `src/backend/domain/services/HermesDecisionEngine.ts` (`priceEstimateSuggestion` delegates; `researchRefresher` → `IPriceResearchRuns`), `IPriceResearchRepository.saveEstimate` (guard), `src/shared/types/index.ts` (`StoredPriceEstimate.researchUpdatedAt: string | null`), `priceEstimate.ts` (unchecked rows excluded)

**Interfaces:**
- Produces:
  ```ts
  export class PriceEstimateService {
    estimate(product: Product, listing: Listing): Promise<{ suggestion: Suggestion | null; stored: StoredPriceEstimate | null; skipped: 'research_pending' | null }>;
  }
  export type PriceReadiness = 'ready' | 'degraded' | 'blocked';
  export function priceReadiness(input: { lastRun: ResearchRun | null; research: PriceResearch | null; estimate: StoredPriceEstimate | null }): PriceReadiness;
  // ready: lastRun.outcome 'ok', or 'partial' with ≥1 classChecked substitute row, and estimate.researchUpdatedAt === research.updatedAt; degraded: some research but not ready; blocked: no successful research or last run failed with no stored ladder.
  ```
- Engine: calls `runs.request(force: false, trigger: 'analyze')` (never awaits a run), then `PriceEstimateService.estimate`. Skip rule: no successful research stored and a run active → `skipped: 'research_pending'`, no estimate call, the Hermes panel gets the pending copy. The job's re-estimate replaces the product's pending price suggestion event (same `type` family, previous pending one superseded as the engine already does for repeated runs).
- `saveEstimate(…, stored)` writes only if `stored.researchUpdatedAt >= current.researchUpdatedAt` (null counts as oldest).

- [ ] **Step 1: Failing tests.** `older researchUpdatedAt does not overwrite`; `unchecked substitutes do not feed the ceiling` (rows with `classChecked: false` → no substitute cap, tier confidence ignores them); skip when research pending; estimate uses `missingAccessories` (prompt receives it); `priceReadiness` cases for ready/degraded/blocked.
- [ ] **Step 2–4:** FAIL → implement → PASS; full Jest.
- [ ] **Step 5: q4j** (`PriceEstimateLadderTest`, CI stand): existing three tests still pass with the job-based flow (run endpoint returns; the estimate is stored from saved rows since research is not configured); add `estimateMentionsMissingAccessories` only if the offline provider echoes reasoning — otherwise assert the product field round-trip there and leave the prompt check to Jest (state which in the report).
- [ ] **Step 6: Commit** `feat(pricing): re-estimate when research lands and guard against stale estimates`

### Task 7: API run state and the product page

**Files:**
- Modify: `ProductController` GET research (adds `run`, `lastRun`, `nextAutoAt`, `readiness`), `src/shared/types/index.ts` (`PriceResearchView`)
- Modify: `src/frontend/state/api/productsApi.ts` (`refreshPriceResearch` returns `{ run }`; `getPriceResearch` polling), `src/frontend/components/product-detail/PriceResearchSection.tsx`, `priceResearchModel.ts` + test
- Test (q4j UI): `PriceResearchUiTest.java`, `ProductDetailPage.java`

**Interfaces:**
- Produces: `GET /api/products/:id/price-research` → `{ ...PriceResearch, run: ResearchRun | null, lastRun: ResearchRun | null, nextAutoAt: string | null, readiness: PriceReadiness }` (`data: null` stays when nothing exists and no run).
- Model functions: `runProgressText(run: ResearchRun | null): string | null`, `lastRunText(last: ResearchRun | null, nextAutoAt: string | null, now: Date): string | null`, `classLine(row: PriceComparable): string | null` (e.g. `720p · 200 ANSI lm`; `class unchecked` when `classChecked === false`). Exact copy from Global Constraints.
- Polling: `useGetPriceResearchQuery(productId, { pollingInterval: active ? 5000 : 0 })`, read `currentData`; when the run turns finished, invalidate `PriceResearch` and the product's Hermes events. Dirty editor + changed `updatedAt` → show `New prices found. Reload to see them.` instead of re-keying.

- [ ] **Step 1: Failing Jest** for the three model functions (all copy variants) and the dirty-editor decision function `shouldRekeyEditor(dirty: boolean, prevUpdatedAt, nextUpdatedAt): 'rekey' | 'notice' | 'keep'`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run type-check && npm run build`.
- [ ] **Step 5: q4j UI** `findPricesShowsNotConfigured` (still the 503 copy), `missingAccessoriesFieldSaves` (form field), `substituteShowsClassLine` (seed an auto row with `classAttributes` via API → line `720p · 200 ANSI lm`). `compileTestJava`.
- [ ] **Step 6: Commit** `feat(ui): show price research progress, last run and class per substitute`

### After all tasks

- [ ] Whole-branch review; live q4j on an isolated stand (`scripts/ci-java-api-tests.sh`, JDK 21) plus the Java lint command from CI (`./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest archgateCheck`).
- [ ] PR with a test plan; after deploy, the QH11 check by hand on prod: substitutes of the 720p / ~200 ANSI class, no BenQ-class rows, ceiling roughly 150–240 zł, estimate reasoning names the missing remote.
