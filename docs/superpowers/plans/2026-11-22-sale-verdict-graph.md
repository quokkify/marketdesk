# Sale Verdict Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Analyze engine and the single-prompt AI paths with a background LangGraph sale-verdict graph whose checks (info, price, photos) are composable subgraphs run by scope.

**Architecture:** `SaleVerdictGraph` loads the product, routes to the subgraphs named in the run's scope, combines their fresh results with the latest stored results of the other checks, and saves one verdict row. Runs go through a queue (`sale-verdict`) like price research. The proposal-making code of `HermesDecisionEngine` (SEO events, price events) is moved, not rewritten, into two services the subgraphs call; then the engine, Improve and `suggestPrice` are deleted.

**Tech Stack:** TypeScript, Express, `@langchain/langgraph` 1.5, zod 4, Postgres (plain SQL migrations), Bull, React + RTK Query, q4j (Java 21, TestNG, Allure) in `test-automation/`.

**Spec:** `docs/superpowers/specs/2026-11-22-sale-verdict-graph-design.md`

## Global Constraints

- Graph version constant: `SALE_VERDICT_GRAPH_VERSION = 'sale-verdict@1'`.
- Check names: `'info' | 'price' | 'photos'`. Overall: `'ready' | 'fix' | 'needs_human'`.
- Seller free text and Hermes text never go into graph state, logs or reason codes (same rule as `PriceResearchGraph`, `ConversationReplyGraph`).
- Migrations replay on every start: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, never a `DROP`.
- Research runs only in its own background job (`IPriceResearchRuns` contract: "the graph runs in a background job, never in the caller"). The verdict never runs `PriceResearchGraph` itself.
- AI usage scope feature name for verdict runs: `'verdict'`.
- New behaviour is tested with live q4j tests in `test-automation` (`./gradlew apiTest`, `./gradlew uiTest`, `JAVA_HOME` = Homebrew openjdk@21) against an isolated Compose stack built from the branch. Jest is used only for pure functions without mocks and for minimal edits that keep existing tests compiling. The API stack has no research profile and answers AI from offline heuristics; real Hermes paths are checked by hand on production and the PR says so.
- No secret-looking literals in tests or docs (Gitleaks scans full branch history).

## Deviation from the spec (confirm with the owner before Task 4)

The spec says the price check "runs `PriceResearchGraph` inline as a subgraph and waits". The code forbids running research outside its job, and a verdict job blocking up to 7 minutes on another job is fragile. The plan instead: the price check **requests** research when it is due (`IPriceResearchRuns.request(..., { force: false, trigger: 'analyze' })`) and returns status `pending` with reason `research_running`; when the research job finishes, its `afterRun` hook requests a verdict run with scope `['price']`. The seller sees "price: researching…" and then the price verdict, without pressing anything again. This adds check status `pending` (overall is unaffected by a pending check unless every check is pending; see Task 1).

Second, smaller deviation: the spec's table says Recheck "also writes its check into the verdict".
This plan leaves Recheck exactly as it is (synchronous, pre-publish) and does not write it into the
verdict; the verdict's info check reuses Recheck's logic instead. Writing a code-only info check
from Recheck can follow once the verdict UI exists.

## Review Focus

1. A product with no listing, or a non-PLN listing, pressed Analyze → verdict completes with price `needs_human` (`no_listing` / `not_pln`), info and photos still evaluated. Test in Task 6.
2. Two Analyze clicks in a row (or Analyze then Review price) → one active run, the second request returns it. Test in Task 6.
3. Hermes unreachable during the info SEO call → info check `needs_human` with `check_failed`, price and photos still complete, run `completed`. Test in Task 4 (pure combine) and Task 6 (offline stack path).
4. Product edited after the verdict → UI shows "out of date". Test in Task 8.
5. A foreign workspace's product id on run/verdict endpoints → 404, nothing queued. Test in Task 6.

---

## File Structure

Create:
- `src/shared/types/index.ts` (modify) — verdict types.
- `src/backend/domain/services/saleVerdictRules.ts` — pure rules: check mapping and combine.
- `src/backend/persistence/migrations/054_product_sale_verdicts.sql` — table.
- `src/backend/domain/repositories/interfaces/ISaleVerdictRepository.ts`, `src/backend/infrastructure/persistence/repositories/SaleVerdictRepository.ts`.
- `src/backend/application/services/verdict/ListingSeoProposals.ts` — SEO events (moved from the engine).
- `src/backend/application/services/verdict/PriceProposals.ts` — price events (moved from the engine).
- `src/backend/application/services/verdict/infoCheckGraph.ts`, `priceCheckGraph.ts`, `photosCheckGraph.ts` — subgraphs.
- `src/backend/application/services/verdict/SaleVerdictGraph.ts` — orchestrator.
- `src/backend/application/services/verdict/SaleVerdictRuns.ts` — request/latest, TTL.
- `src/backend/infrastructure/jobQueue/JobHandlers/SaleVerdictHandler.ts`.
- `src/frontend/components/products/VerdictSummary.tsx` — row/page verdict display.
- q4j: `test-automation/.../service/VerdictService.java`, `step/VerdictSteps.java`, `test/api/SaleVerdictTest.java`, `test/ui/SaleVerdictUiTest.java`.

Delete (Task 7): `src/backend/domain/services/HermesDecisionEngine.ts` and its tests; `improve` branch of `ProductAssistanceGraph`; `POST /products/:id/improvements`; `IAIProvider.suggestPrice` and all implementations.

---

### Task 1: Verdict types and pure rules

**Files:**
- Modify: `src/shared/types/index.ts` (after `ProductRecheckResult`, ~line 460)
- Create: `src/backend/domain/services/saleVerdictRules.ts`
- Test: `src/backend/domain/services/__tests__/saleVerdictRules.test.ts` (pure, no mocks)

**Interfaces:**
- Produces (shared types):
  ```ts
  export type VerdictCheckName = 'info' | 'price' | 'photos';
  export type VerdictCheckStatus = 'ready' | 'fix' | 'needs_human' | 'pending';
  export type VerdictOverall = 'ready' | 'fix' | 'needs_human';
  export interface VerdictReason { code: string; message: string; field?: ProductRecheckItem['editField'] }
  export interface VerdictCheck {
    check: VerdictCheckName; status: VerdictCheckStatus; reasons: VerdictReason[];
    checkedAt: string; refs: { eventIds: string[]; researchUpdatedAt?: string | null };
  }
  export type VerdictRunStatus = 'queued' | 'running' | 'completed' | 'failed';
  export interface SaleVerdict {
    id: string; productId: string; listingId: string | null; graphVersion: string;
    scope: VerdictCheckName[]; status: VerdictRunStatus; overall: VerdictOverall | null;
    checks: Partial<Record<VerdictCheckName, VerdictCheck>>; createdAt: string; completedAt: string | null;
  }
  export interface ProductVerdictView { latest: SaleVerdict | null; active: SaleVerdict | null; lastFailed: boolean }
  ```
- Produces (`saleVerdictRules.ts`):
  - `MIN_PHOTOS = 1`
  - `photosCheck(imageCount: number, now: Date): VerdictCheck`
  - `infoCheckFromRecheck(items: ProductRecheckItem[], now: Date): VerdictCheck` — uses items with key `title | description | required_fields | category | marketplace`; `fix`→`fix`, `review`→`needs_human`; reason code = `info_<key>`, message = the item message, field = editField.
  - `priceCheckFromEstimate(input: PriceCheckInput, now: Date): VerdictCheck` where
    ```ts
    type PriceCheckInput =
      | { kind: 'no_listing' } | { kind: 'not_pln' } | { kind: 'not_configured' }
      | { kind: 'research_running' } | { kind: 'failed' }
      | { kind: 'estimated'; currentPrice: number; stored: StoredPriceEstimate | null;
          suggestionType: HermesEventType | null; eventIds: string[] };
    ```
  - `checkFailed(check: VerdictCheckName, now: Date): VerdictCheck` — `needs_human`, code `check_failed`.
  - `combineVerdict(fresh: VerdictCheck[], previous: Partial<Record<VerdictCheckName, VerdictCheck>>): { checks: Partial<Record<VerdictCheckName, VerdictCheck>>; overall: VerdictOverall }`

**Fair-price mapping (`kind: 'estimated'`)**, in order:
1. `suggestionType === 'price_estimate_unavailable'` or `stored === null` → `needs_human`, `estimate_unavailable`.
2. `stored.hiddenReason === 'low_confidence'` → `needs_human`, `weak_research`.
3. `currentPrice > stored.estimate.startPrice` and `suggestionType === 'suggested_lower_price'` → `fix`, `above_ceiling` (message names the ceiling).
4. `currentPrice < stored.estimate.floorPrice` → `fix`, `below_floor`.
5. Otherwise → `ready`, `fair_price` (covers `within_threshold`, `floor_cancels`, and a higher-price suggestion that is still within the band; that suggestion's event stays as an optional proposal).

Other kinds: `no_listing`, `not_pln`, `not_configured`, `failed`(→`check_failed`) → `needs_human`; `research_running` → `pending`.

**Combine:** fresh results replace previous ones by check name; overall over non-`pending` checks: any `needs_human` → `needs_human`; else any `fix` → `fix`; else `ready`. If every present check is `pending` → `needs_human`.

- [ ] **Step 1: Write failing tests** `saleVerdictRules.test.ts`:
  - `photosCheck(0)` → `fix` reason `photos_missing`; `photosCheck(3)` → `ready`.
  - price: each of rules 1–5 with `stored.estimate = { startPrice: 279, floorPrice: 250, confidence: 'medium', … }`: current 349 + `suggested_lower_price` → `fix`/`above_ceiling`; current 240 → `fix`/`below_floor`; current 279, hiddenReason `within_threshold` → `ready`; hiddenReason `low_confidence` → `needs_human`/`weak_research`; `research_running` → `pending`.
  - info: recheck items `[{key:'description',status:'fix',…},{key:'title',status:'ready',…}]` → `fix` with one reason `info_description`.
  - combine: previous `{info: ready@T0}` + fresh `[price fix@T1]` → checks keep info@T0, overall `fix`; fresh `[info check_failed]` → overall `needs_human`; only `pending` → `needs_human`.
- [ ] **Step 2:** `npx jest src/backend/domain/services/__tests__/saleVerdictRules.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Add the types and implement `saleVerdictRules.ts`.
- [ ] **Step 4:** Same command → PASS; `npm run type-check` → no errors.
- [ ] **Step 5: Commit** `feat(verdict): add sale verdict types and rules`.

---

### Task 2: Verdict storage

**Files:**
- Create: `src/backend/persistence/migrations/054_product_sale_verdicts.sql`
- Modify: `src/backend/persistence/schema.sql` (add the same table, following how 053 appears there)
- Create: `src/backend/domain/repositories/interfaces/ISaleVerdictRepository.ts`, `src/backend/infrastructure/persistence/repositories/SaleVerdictRepository.ts`

**Interfaces:**
- Consumes: `SaleVerdict`, `VerdictCheck*` from Task 1.
- Produces:
  ```ts
  export interface NewVerdictRun { id: string; workspaceId: string; productId: string; scope: VerdictCheckName[]; queuedAt: string }
  export interface ISaleVerdictRepository {
    insertQueued(run: NewVerdictRun): Promise<SaleVerdict | null>;      // null: product already has an active run
    findActive(workspaceId: string, productId: string): Promise<SaleVerdict | null>;
    claim(runId: string, startedAt: string, leaseUntil: string): Promise<SaleVerdict | null>;
    setListing(runId: string, listingId: string | null): Promise<void>;
    complete(runId: string, fields: { overall: VerdictOverall; checks: Partial<Record<VerdictCheckName, VerdictCheck>>; completedAt: string }): Promise<boolean>;
    fail(runId: string, completedAt: string, errorCode: string): Promise<boolean>;
    findLatestCompleted(workspaceId: string, productId: string): Promise<SaleVerdict | null>;
    findLatestCompletedForProducts(workspaceId: string, productIds: string[]): Promise<Map<string, SaleVerdict>>;
    lastRunFailed(workspaceId: string, productId: string): Promise<boolean>;
  }
  ```
- Table `product_sale_verdicts`: `id UUID PK`, `workspace_id UUID NOT NULL`, `product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE`, `listing_id UUID NULL`, `graph_version VARCHAR(40) NOT NULL`, `scope TEXT[] NOT NULL`, `status VARCHAR(20) NOT NULL`, `overall VARCHAR(20)`, `checks JSONB NOT NULL DEFAULT '{}'::jsonb`, `error_code VARCHAR(60)`, `queued_at`, `started_at`, `completed_at`, `lease_until` (all `TIMESTAMP`). Indexes: `(product_id, queued_at DESC)`; partial unique `(product_id) WHERE status IN ('queued','running')`; `(workspace_id, product_id, completed_at DESC) WHERE status = 'completed'`.

Model the repository on `PriceResearchRunRepository` (same insert-on-conflict-do-nothing for the active index, same claim/lease SQL). Every query filters by `workspace_id`.

- [ ] **Step 1:** Write the migration and schema entry.
- [ ] **Step 2:** Implement the repository.
- [ ] **Step 3:** `npm run type-check` → clean; start the isolated stack and check the server log shows the migration applied twice-safe (restart the backend container once, no error).
- [ ] **Step 4: Commit** `feat(verdict): store sale verdict runs`.

(The repository is exercised end to end by the q4j tests in Task 6.)

---

### Task 3: Move proposal code out of the engine

Behaviour-preserving move. The engine keeps working by delegating to the new classes until Task 7 deletes it.

**Files:**
- Create: `src/backend/application/services/verdict/ListingSeoProposals.ts`, `.../verdict/PriceProposals.ts`
- Modify: `src/backend/domain/services/HermesDecisionEngine.ts` (delegate), `src/backend/config/di/container.ts:505-535`

**Interfaces:**
- Produces:
  ```ts
  class ListingSeoProposals {
    constructor(deps: { products; listings; events: IEventRepository; ai: Pick<IAIProvider,'analyzeListingSeo'|'activeProvider'>; idFactory: () => string; logger? })
    // Body = HermesDecisionEngine.runProductSeo lines 206–360 (SEO part, fingerprints, dedup, offline label), unchanged.
    propose(workspace: Workspace, product: Product, primary: Listing | null): Promise<HermesEvent[]>;
  }
  class PriceProposals {
    constructor(deps: { products; listings; events: IEventRepository; estimates: PriceEstimateService; runs: IPriceResearchRuns | null; ai: Pick<IAIProvider,'activeProvider'>; idFactory; logger? })
    // = engine.requestResearch + priceEstimateSuggestion + savePriceEvent, returning what the price check needs.
    proposeForVerdict(product: Product, primary: Listing): Promise<{ researchRequested: RunRequestReason | 'request_failed' | null; skipped: 'research_pending' | null; stored: StoredPriceEstimate | null; suggestionType: HermesEventType | null; eventIds: string[] }>;
    reestimatePrice(workspaceId: string, productId: string): Promise<HermesEvent | null>;          // moved as is
    reestimateAfterResearch(workspaceId: string, productId: string, run: { outcome: RunOutcome; rowsChanged: boolean } | null): Promise<HermesEvent | null>; // moved as is
  }
  ```
- Container: `priceResearchRuns.onExpired` and `PriceResearchHandler.afterRun` call `priceProposals.reestimateAfterResearch` instead of `hermesEngine`.

- [ ] **Step 1:** Run the engine's existing Jest tests: `npx jest HermesDecisionEngine PriceEstimateService container` → record PASS as the baseline.
- [ ] **Step 2:** Move the code; make `runProductSeo` call `ListingSeoProposals.propose` then `PriceProposals.proposeForVerdict`.
- [ ] **Step 3:** Same command → PASS (only constructor wiring edits in tests allowed). `npm run type-check` → clean.
- [ ] **Step 4: Commit** `refactor(verdict): move SEO and price proposals out of the decision engine`.

---

### Task 4: Check subgraphs and SaleVerdictGraph

**Files:**
- Create: `.../verdict/infoCheckGraph.ts`, `.../verdict/priceCheckGraph.ts`, `.../verdict/photosCheckGraph.ts`, `.../verdict/SaleVerdictGraph.ts`
- Test: `src/backend/application/services/verdict/__tests__/SaleVerdictGraph.test.ts` — only the routing (which subgraphs ran for a scope), using in-memory fakes of the three subgraph functions; no repository mocks.

**Interfaces:**
- Consumes: Task 1 rules, Task 2 repository, Task 3 services, `ProductRecheckService.recheck`.
- Produces:
  ```ts
  export interface CheckContext { workspace: Workspace; product: Product; listing: Listing | null; marketplace: Marketplace | null; now: () => Date }
  export type CheckGraph = (ctx: CheckContext) => Promise<VerdictCheck>;   // each file exports a factory returning a compiled StateGraph wrapped as CheckGraph
  export function buildInfoCheck(deps: { recheck: Pick<ProductRecheckService,'recheck'>; seo: ListingSeoProposals }): CheckGraph;
  export function buildPriceCheck(deps: { proposals: PriceProposals }): CheckGraph;
  export function buildPhotosCheck(): CheckGraph;
  export const SALE_VERDICT_GRAPH_VERSION = 'sale-verdict@1';
  export interface VerdictTransition { node: 'load' | 'route' | VerdictCheckName | 'combine' | 'save'; phase: 'started' | 'completed' | 'failed' }
  export class SaleVerdictGraph {
    constructor(deps: { products; listings; marketplaces; workspaces; verdicts: ISaleVerdictRepository; checks: Record<VerdictCheckName, CheckGraph>; now: () => Date; observe?: (t: VerdictTransition) => void });
    run(input: { workspaceId: string; runId: string; scope: VerdictCheckName[] }): Promise<SaleVerdict>;
  }
  ```
- Info subgraph nodes: `codeChecks` (recheck when a listing exists; without a listing, condition/title/description checks via `missingFacts` + `fitsOlxTitle`) → `seo` (only when `workspace.listingSeoEnabled`; `ListingSeoProposals.propose`; its failure marks the check `needs_human`/`check_failed` but keeps code-check reasons) → `result`.
- Price subgraph nodes: `guard` (no listing / non-PLN / not configured) → `estimate` (`PriceProposals.proposeForVerdict`) → `rule` (`priceCheckFromEstimate`).
- Photos subgraph: one node, `photosCheck(product.imageCount)`.
- `SaleVerdictGraph`: `load` → conditional `route` to the scoped checks (parallel) → `combine` (with `findLatestCompleted(...).checks` as previous) → `save` (`complete`). A check that throws becomes `checkFailed(name)`. All Hermes calls inside `withAiUsageScope({ workspaceId, feature: 'verdict', productId })`.

- [ ] **Step 1: Write failing test** `SaleVerdictGraph.test.ts`: scope `['price']` → only the price fake called and saved checks contain the previous info/photos untouched; scope all → all three called; a throwing photos fake → saved photos check `check_failed`, run completed.
- [ ] **Step 2:** `npx jest SaleVerdictGraph` → FAIL.
- [ ] **Step 3:** Implement the three subgraphs and the orchestrator.
- [ ] **Step 4:** `npx jest SaleVerdictGraph saleVerdictRules` → PASS; `npm run type-check` → clean.
- [ ] **Step 5: Commit** `feat(verdict): sale verdict graph with scoped check subgraphs`.

---

### Task 5: Runs, queue and handler

**Files:**
- Create: `.../verdict/SaleVerdictRuns.ts`, `src/backend/infrastructure/jobQueue/JobHandlers/SaleVerdictHandler.ts`
- Modify: `src/backend/application/ports/IJobQueue.ts` (add `SaleVerdictJob { workspaceId; productId; runId }`), `src/backend/config/di/container.ts` (queue `sale-verdict`, `attempts: 1`, wiring; research `afterRun` also calls `saleVerdictRuns.request(ws, pid, ['price'], 'research')` after the re-estimate, only if the product has a completed verdict)

**Interfaces:**
- Produces:
  ```ts
  export const VERDICT_RUN_TTL_MS = 15 * 60 * 1000;
  export type VerdictTrigger = 'manual' | 'research';
  class SaleVerdictRuns {
    request(workspaceId: string, productId: string, scope: VerdictCheckName[], trigger: VerdictTrigger): Promise<{ run: SaleVerdict; enqueued: boolean }>; // 404 for foreign/missing product; returns the active run when one exists
    view(workspaceId: string, productId: string): Promise<ProductVerdictView>;   // expires an active run older than the TTL to failed (error_code 'expired') before answering
    viewsFor(workspaceId: string, productIds: string[]): Promise<Map<string, SaleVerdict>>;
  }
  class SaleVerdictHandler { handle(job: SaleVerdictJob): Promise<{ kind: 'skipped' } | { kind: 'finished'; status: VerdictRunStatus }> }
  ```
  Handler: claim (lease 10 min, budget 8 min via `AbortSignal`), run graph, on throw `fail(runId, now, 'run_error')`; never retried by the queue.

- [ ] **Step 1:** Implement runs + handler + wiring.
- [ ] **Step 2:** `npm run type-check` → clean; `npx jest container` → PASS.
- [ ] **Step 3: Commit** `feat(verdict): run sale verdicts in a background queue`.

(Behaviour is proven by Task 6's q4j tests.)

---

### Task 6: API and q4j API tests

**Files:**
- Modify: `src/backend/presentation/http/validation/schemas.ts:382` (`runProductHermesSchema` gains `scope: z.array(z.enum(['info','price','photos'])).min(1).max(3).optional()`), `controllers/HermesController.ts:174` (`runForProduct` → `saleVerdictRuns.request`, 202 with the run), `routes/hermes.ts` (add `GET /products/:productId/verdict` → `ProductVerdictView`), product list presenter/controller (attach `verdict: SaleVerdict | null` per product via `viewsFor`, one query), `RunHermesUseCase`/`HermesApplicationService` (route to `SaleVerdictRuns`).
- Modify q4j: `service/ProductService.java` (run body with optional scope), create `service/VerdictService.java`, `step/VerdictSteps.java` (`runAnalyze`, `runScope`, `awaitVerdict(account, productId, timeout 60 s)`, verify methods), `test/api/SaleVerdictTest.java`.
- Modify existing Jest only to compile: `api.integration.test.ts`, `abuseLimits.test.ts`, `hermesApi.test.ts`.

**q4j tests (`SaleVerdictTest`):**
- `analyzeQueuesARunAndCompletes` — POST run → 202 with `status` queued/running; poll verdict → `completed`, `graphVersion` `sale-verdict@1`, checks `info`, `price`, `photos` present.
- `productWithoutListingGetsPriceNeedsHuman` — price `needs_human` reason `no_listing`; info and photos evaluated (Review Focus 1).
- `researchNotConfiguredGetsPriceNeedsHuman` — PLN listing, API stack → price `needs_human` `not_configured`.
- `noPhotosIsFix` — photos `fix` `photos_missing`, overall not `ready`.
- `missingConditionIsInfoFix` — condition unknown → info `fix`.
- `secondRequestReturnsActiveRun` — two POSTs back to back → same run id (Review Focus 2).
- `priceScopeKeepsOtherChecks` — full run, then `scope: ['price']` → info/photos `checkedAt` unchanged, price `checkedAt` newer.
- `offlineSeoDoesNotFailVerdict` — `listingSeoEnabled` on, offline stack → run `completed`, info present (Review Focus 3).
- `otherWorkspaceIs404` on POST run and GET verdict, nothing queued (Review Focus 5); `requiresLogin`.
- `catalogueCarriesLatestVerdict` — GET products → the product has `verdict.overall`.

- [ ] **Step 1:** Write the q4j tests and steps.
- [ ] **Step 2:** Build an isolated stack from the branch *before* the API changes (stash nothing: run from the Task 5 commit in a separate worktree) → `./gradlew apiTest --tests '*SaleVerdictTest*'` → FAIL (404 on verdict endpoint).
- [ ] **Step 3:** Implement the API changes.
- [ ] **Step 4:** Rebuild the stack, rerun → PASS; `npm test -- --ci --forceExit` with `SKIP_REDIS_TESTS=true` → PASS; `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat(verdict): Analyze queues a sale verdict and serves it`.

---

### Task 7: Remove the old implementation

**Files:**
- Delete: `src/backend/domain/services/HermesDecisionEngine.ts` and its `__tests__`; engine construction in `container.ts`.
- Modify: `ProductAssistanceGraph.ts` (drop `improve` node and `kind: 'improve'`; `revive` price from `PriceProposals`' stored estimate: `research.findByProduct(...).lastEstimate` → `price: { suggestedPrice: startPrice, reasoning, confidence }` when present, otherwise `aiIssues: ['price']`; no research run requested), `ProductController.ts` + `routes/products.ts:35` (remove improvements), `IAIProvider.ts:47` (remove `suggestPrice`, `PriceSuggestionContext`, `PriceSuggestion` if unused), `HermesAI.ts`, `OfflineHeuristicAIProvider.ts`, `AIProviderSelector.ts`, `domain/testkit/support.ts`, `experiments/ProductAssistanceExperiment.ts` (+ its test), Jest tests listed by `git grep -l suggestPrice` (remove the cases for deleted code only).
- Modify q4j: remove Improve calls from `ProductService.java`, `ProductSteps.java`, `AiUsageTest.java`, `AiUsageUiTest.java` (point AI-usage tests at Analyze); add to `SaleVerdictTest`: `improvementsEndpointIsGone` (POST `/api/products/{id}/improvements` → 404) and `revivalProposalWithoutResearchHasNoPrice` (expired OLX listing fixture as in the existing revival tests → `aiIssues` contains `price`).

- [ ] **Step 1:** Add the two q4j tests → run against the stack from Task 6 → FAIL (improvements still 200).
- [ ] **Step 2:** Delete and rewire.
- [ ] **Step 3:** `git grep -n -E "suggestPrice|HermesDecisionEngine|proposeImprovements|'improve'" -- src test-automation` → no hits outside CHANGELOG files.
- [ ] **Step 4:** `npm run type-check && npm run lint && SKIP_REDIS_TESTS=true npx jest --ci --forceExit` → PASS; rebuild stack, `./gradlew apiTest` → PASS.
- [ ] **Step 5: Commit** `refactor(hermes)!: remove the decision engine, Improve and single-prompt pricing`.

---

### Task 8: Frontend

**Files:**
- Create: `src/frontend/components/products/VerdictSummary.tsx` (+ pure helper `verdictDisplay.ts` with `isVerdictStale(verdict, productUpdatedAt, listingUpdatedAt): boolean` and `checkLabel(check): string`)
- Modify: `src/frontend/state/api/hermesApi.ts` (`runHermes` returns `SaleVerdict`, accepts `scope`; new `getProductVerdict` query with `pollingInterval: 3000` while `active` is set, tag `SaleVerdict` per product; research refresh invalidates it), `dto.ts:238`, `ProductsPage.tsx:187-235` (row shows `VerdictSummary`; `runRowAnalysis` no longer counts events; bulk run keeps one-at-a-time), `ListingDetailsPage.tsx` (verdict block, **Review price** button = `runHermes({ productId, scope: ['price'] })`, remove Improve button and `useProposeProductImprovements`), `services/hooks/index.ts`, `productsApi.ts`.
- Test: `src/frontend/components/products/__tests__/verdictDisplay.test.ts` (pure); q4j `test/ui/SaleVerdictUiTest.java`.

Row display (from the spec):
```
AirPods Pro 2   ● Not ready   Info ✓  Price ✗ 349 → 279 zł  Photos ✓(4)   [Analyze]
                └ Price above the market ceiling: used same model 240–290 zł
```
Overall labels: `ready` → "Ready to sell", `fix` → "Not ready", `needs_human` → "Needs you"; `pending` check → "researching…"; stale → "Out of date — run Analyze"; `lastFailed` → "Last run failed" next to the previous verdict. Each check shows its age when older than the newest check.

- [ ] **Step 1:** Write `verdictDisplay.test.ts` (stale when `productUpdatedAt > completedAt`; not stale otherwise; labels above) → FAIL.
- [ ] **Step 2:** Write `SaleVerdictUiTest`: `analyzeShowsVerdictInRow` (click Analyze → row shows "Not ready" and a Photos ✗ for a product without images), `reviewPriceRunsOnlyPrice` (product page → Review price → price line updates, info unchanged), `editMarksVerdictOutOfDate` (edit description → "Out of date") → FAIL on the Task 7 stack.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx jest verdictDisplay` → PASS; rebuild stack, `./gradlew uiTest --tests '*SaleVerdictUiTest*'` → PASS; `npm run type-check && npm run lint` → clean.
- [ ] **Step 5: Commit** `feat(verdict): show the sale verdict and a Review price button`.

---

### Task 9: Whole-branch verification

- [ ] **Step 1:** `npm run type-check && npm run lint && SKIP_REDIS_TESTS=true npx jest --ci --forceExit` → PASS.
- [ ] **Step 2:** Isolated stack from the branch head; `./gradlew apiTest uiTest` → PASS.
- [ ] **Step 3:** Scan changed files for `TODO`, `.skip`, `.only`, `@Test(enabled = false)` → none.
- [ ] **Step 4:** Gitleaks over the branch before the first push → clean.
- [ ] **Step 5:** PR description lists what is checked by hand on production (real Hermes SEO, real research → `price` scope follow-up run, AirPods expected ~279/~250 PLN).
