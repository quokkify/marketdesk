# One Hermes Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Price research, Sale verdict, Hermes and Activity rail cards of the product page with one Hermes card and a details drawer that holds market prices, checks, suggestions and the run history.

**Architecture:** Two read-only list endpoints expose the run history that `price_research_runs` and `product_sale_verdicts` already keep; a nullable `research_run_id` links a verdict run to its market search. On the frontend, two pure view-model modules (`hermesCardModel`, `hermesHistory`) turn API data into what the card and the history tab render; the components stay thin. The existing run, apply and save endpoints are reused unchanged.

**Tech Stack:** TypeScript, Express, Postgres, React + MUI, RTK Query, Jest (pure functions only), q4j live API/UI tests in `test-automation` (JDK 21).

**Spec:** `docs/superpowers/specs/2026-11-22-hermes-card-redesign-design.md`

## Global Constraints

- Rail order: price card, Statistics, Hermes. No other AI card stays in the rail.
- Analyze and Analyze again call the existing run with `forceResearch: false`; only **Search again** forces a market search (the existing `POST /products/:id/price-research/refresh`).
- The "Review price" button is removed.
- **Set price to {proposed}** approves the event in `checks.price.refs.eventIds` through the same mutation as Apply in the suggestion queue.
- The stored retail fields (`retailPrice`, `retailCurrency`, `retailSource`, `retailCheckedAt`) and `PUT /products/:id/price-research` keep their contract.
- Manual prices are never removed by a search; a manual comparable is written with `source: 'manual'`.
- Migrations replay on every start: additive, `IF NOT EXISTS`, no `DROP`.
- List endpoints: default `limit` 20, maximum 50, workspace-scoped, no `aiLimiter`.
- Jest tests cover pure functions and render-to-static-markup only, no mocks of services; API and click behaviour is tested by q4j in `test-automation`.
- UI copy is English and uses the vocabulary of the spec: Market prices, Price, Info, Photos, Suggestions, Log and history, Your prices, Search again.
- No internal codes in primary copy; error codes map to plain sentences (reuse `ERROR_REASONS` in `priceResearchModel.ts`).

## Review Focus

- A price added by hand while another tab or a search changed the research: the save returns 409; the form keeps what was typed and shows "Prices changed. Reload and add it again." with a Reload action. (Task 6)
- The price recommendation was already applied or dismissed: the primary action is "Analyze again", never a dead "Set price" button. (Task 4)
- A listing that is not in PLN: Search again is disabled with the existing reason "OLX search needs a PLN listing"; adding your own prices still works. (Task 6)
- 30 comparables already stored: the add form is disabled and says "30 prices is the limit. Remove one to add another." (Task 6)
- A run that failed or expired mid-way: the card shows "Last run failed" with the reason sentence and keeps the previous verdict's rows; the history entry lists the steps that did finish. (Tasks 3, 4)

---

### Task 1: Link a verdict run to its market search

**Files:**
- Create: `src/backend/persistence/migrations/055_sale_verdict_research_run.sql`
- Modify: `src/backend/persistence/schema.sql` (table `product_sale_verdicts`)
- Modify: `src/shared/types/index.ts` (`SaleVerdict`)
- Modify: `src/backend/domain/repositories/interfaces/ISaleVerdictRepository.ts`
- Modify: `src/backend/infrastructure/persistence/repositories/SaleVerdictRepository.ts`
- Modify: `src/backend/application/services/verdict/SaleVerdictRuns.ts` (`enqueue`)
- Modify: `src/backend/application/services/recordedResearchRun.ts` and its caller in `verdict/priceCheckGraph.ts`
- Test: `src/backend/infrastructure/persistence/repositories/__tests__/SaleVerdictRepository.integration.test.ts`

**Interfaces:**
- Produces: `SaleVerdict.researchRunId: string | null`, `SaleVerdict.errorCode: string | null`; `ISaleVerdictRepository.setResearchRun(runId: string, researchRunId: string): Promise<void>`.

- [ ] **Step 1: Write the failing integration test.** Follow `PriceResearchRunRepository.integration.test.ts` (session TEMP tables, guarded; never migrate the local database). Tests: `setResearchRun stores the id and findById returns it`; `a new run has researchRunId null`; `a failed run returns its errorCode`.
- [ ] **Step 2: Run it.** `npx jest SaleVerdictRepository.integration --forceExit` — expected: FAIL, `setResearchRun` is not a function.
- [ ] **Step 3: Migration and schema.** `ALTER TABLE product_sale_verdicts ADD COLUMN IF NOT EXISTS research_run_id UUID;` in the migration; the same column in `schema.sql`. No foreign key: research runs are deleted with the product either way.
- [ ] **Step 4: Type, repository, mapping.** Add both fields to `SaleVerdict` and to the row mapper; implement `setResearchRun`.
- [ ] **Step 5: Write the link in both places a search starts.** In `SaleVerdictRuns.enqueue`, after `queueResearch` returns an id. In the job, where `RecordedResearchRun` queues a run for a non-forced analyze: the caller in `priceCheckGraph.ts` knows the verdict run id and calls `setResearchRun` with the queued run's id. A reused, still-fresh research writes no link.
- [ ] **Step 6: Run the test and `npm run type-check`.** Expected: PASS, no type errors (fix every `SaleVerdict` literal the new fields break).
- [ ] **Step 7: Commit.** `feat(verdict): link a verdict run to its market search`

### Task 2: Run history endpoints

**Files:**
- Modify: `src/backend/domain/repositories/interfaces/IPriceResearchRunRepository.ts`, `ISaleVerdictRepository.ts` and both repository implementations
- Modify: `src/backend/domain/ports/IPriceResearchRuns.ts`, `src/backend/application/services/PriceResearchRuns.ts`, `verdict/SaleVerdictRuns.ts`
- Modify: `src/backend/presentation/http/controllers/ProductController.ts`, `HermesController.ts`
- Modify: `src/backend/presentation/http/routes/products.ts`, `routes/hermes.ts`
- Test: `test-automation/src/test/java/dev/quokkify/marketdesk/test/api/RunHistoryTest.java` (plus methods on `PriceResearchService`, `VerdictService` and their steps/verifications)

**Interfaces:**
- Consumes: Task 1 fields.
- Produces:
  - `listForProduct(workspaceId: string, productId: string, limit: number): Promise<ResearchRun[]>` / `Promise<SaleVerdict[]>` on the two repositories, newest `queued_at` first, all statuses.
  - `PriceResearchRuns.history(workspaceId, productId, limit): Promise<ResearchRun[]>` — calls the existing `current()` first so an expired run is listed as failed.
  - `SaleVerdictRuns.history(workspaceId, productId, limit): Promise<SaleVerdict[]>` — calls `expireStuck` first.
  - `GET /api/products/:id/price-research/runs?limit=` → `ResearchRun[]`
  - `GET /api/hermes/products/:productId/verdicts?limit=` → `SaleVerdict[]`

- [ ] **Step 1: Write the q4j API tests.** In `RunHistoryTest`: `verdictHistoryListsNewestFirst` (analyze a product twice, expect ≥ 2 entries, first `queuedAt`/`createdAt` ≥ second); `limitOneReturnsOneEntry`; `limitZeroAndFiftyOneAreRejected` (HTTP 400 each); `unknownProductIs404` for both endpoints; `researchRunsListTheForcedSearch` (after `refresh`, the newest research run has trigger `manual` and the newest verdict's `researchRunId` equals its id); `productWithNoRunsReturnsEmptyList` (HTTP 200, `[]`).
- [ ] **Step 2: Run them against the branch stack.** `JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew test --tests '*RunHistoryTest'` in `test-automation` — expected: FAIL with 404 on the new routes.
- [ ] **Step 3: Repositories and services.** One `SELECT … WHERE workspace_id = $1 AND product_id = $2 ORDER BY queued_at DESC LIMIT $3` each.
- [ ] **Step 4: Controllers and routes.** `listPriceResearchRuns` uses `requireProduct` like `getPriceResearch`; `verdicts` sits next to `verdict`. `limit` is parsed with a shared helper `parseHistoryLimit(raw: unknown): number` (absent → 20; not an integer in 1..50 → `ValidationError`), placed beside `routeParam`. Routes are registered before any `/:id` catch-all that would shadow them; neither gets `aiLimiter`.
- [ ] **Step 5: Run the q4j tests, `npm run type-check`, `npm run lint`.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(api): run history for market searches and verdicts`

### Task 3: History view model and API hooks

**Files:**
- Create: `src/frontend/components/product-detail/hermes/hermesHistory.ts`
- Test: `src/frontend/components/product-detail/hermes/hermesHistory.test.ts`
- Modify: `src/frontend/state/api/productsApi.ts`, `src/frontend/state/api/hermesApi.ts`

**Interfaces:**
- Produces:

```ts
export type StepStatus = 'ok' | 'bad' | 'none';
export interface HistoryStep { label: string; status: StepStatus; detail: string }
export interface HistoryEntry {
  id: string;
  at: string;                       // ISO, start of the run or time of the event
  title: 'Analysis' | 'Price search' | 'Suggestion';
  startedBy: 'you' | 'autopilot' | 'Hermes';
  durationMs: number | null;        // null while running or for an event
  outcome: { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'default' };
  steps: HistoryStep[];
}
export function buildHistory(input: {
  researchRuns: ResearchRun[]; verdicts: SaleVerdict[]; events: HermesEvent[]; currency: string;
}): HistoryEntry[];
```
- `useGetPriceResearchRunsQuery(productId)` providing tag `{ type: 'PriceResearch', id }`; `useGetProductVerdictsQuery(productId)` providing `{ type: 'SaleVerdict', id }`, so the existing invalidations refetch them.

- [ ] **Step 1: Write the failing tests** (fixtures as plain objects):
  - `a verdict with researchRunId and its research run become one Analysis entry with 8 steps` — steps in order: Identify the model, Same model used, Last new price, New substitutes, Used substitutes, Price check, Info check, Photos check.
  - `a research run no verdict points to is a separate Price search entry`; trigger `manual` → `startedBy: 'you'`, `autopilot` → `'autopilot'`.
  - `a verdict without researchRunId is an Analysis entry with 3 steps`.
  - `entries are sorted newest first across the three sources`.
  - `a failed research run maps errorCode to a sentence and marks the unfinished steps 'none'` (asserts the detail contains no underscore-style code).
  - `a running run has durationMs null and outcome tone 'info', label 'Running'`.
  - `outcome labels`: verdict overall uses `overallLabel`; research `ok` → `Prices found`, `partial` → `Partial`, `failed` → `Failed`.
  - `events become Suggestion entries` titled by the event's own summary, `startedBy: 'Hermes'`.
- [ ] **Step 2: Run.** `npx jest hermesHistory` — expected: FAIL, module not found.
- [ ] **Step 3: Implement `buildHistory`** and the two RTK Query endpoints. Step labels and node-status mapping live in this file; error sentences are imported from `priceResearchModel.ts` (export `ERROR_REASONS` lookup as `errorReason(code: string | null): string`).
- [ ] **Step 4: Run.** Expected: PASS. Typecheck the test file with a temporary tsconfig that includes `*.test.*` (the main one excludes tests).
- [ ] **Step 5: Commit.** `feat(frontend): history view model for Hermes runs`

### Task 4: Card view model

**Files:**
- Create: `src/frontend/components/product-detail/hermes/hermesCardModel.ts`
- Test: `src/frontend/components/product-detail/hermes/hermesCardModel.test.ts`

**Interfaces:**
- Consumes: `verdictDisplay.ts` (`overallLabel`, `overallColor`, `leadingReason`, `checkLabel`, `LAST_RUN_FAILED_LABEL`), `priceResearchModel.ts` (`storedEstimateLines` inputs, `anchorsUpdatedAt`, `runProgressText`).
- Produces:

```ts
export type HermesDrawerTab = 'prices' | 'checks' | 'suggestions' | 'history';
export type RowStatus = 'ok' | 'bad' | 'attention' | 'running' | 'idle';
export interface HermesCardRow { key: 'prices' | 'price' | 'info' | 'photos' | 'suggestions'; tab: HermesDrawerTab; title: string; status: RowStatus; value: string; detail: string }
export type HermesPrimaryAction =
  | { kind: 'analyze'; label: 'Analyze product' | 'Analyze again' }
  | { kind: 'set_price'; label: string; eventId: string }
  | { kind: 'none' };
export interface HermesCardState {
  chip: { label: string; color: 'success' | 'warning' | 'error' | 'default' | 'primary'; outlined: boolean };
  lead: string;
  primary: HermesPrimaryAction;
  showAnalyzeAgain: boolean;        // secondary button beside a set_price primary
  rows: HermesCardRow[];            // always five, in key order above
  footer: string;
}
export function hermesCardState(input: {
  verdict: ProductVerdictView | null;
  research: PriceResearchView | null;
  stale: boolean;
  pendingEvents: HermesEvent[];     // unresolved recommendations of this product
  suggestionTotal: number;
  currency: string;
  now: Date;
}): HermesCardState;
```

- [ ] **Step 1: Write the failing tests**, one per row of this matrix:

| Case | chip | lead | primary |
|---|---|---|---|
| no verdict, nothing active | `Not analysed`, default | `Hermes has not looked at this product yet.` | analyze, `Analyze product` |
| active verdict, research run active, 2 nodes done | `Analyzing 3/8`, primary | current step title + `…` | none |
| active verdict, no active research | `Analyzing 1/3` | `Price check…` | none |
| latest `fix`, price check `fix`, its event id is in `pendingEvents` | `overallLabel('fix')`, filled | `leadingReason` text | set_price, `Set price to 169 zł`, that event id; `showAnalyzeAgain: true` |
| same, but the event is not in `pendingEvents` | same | same | analyze, `Analyze again` |
| latest `ready` | `overallLabel('ready')`, success | `Nothing to fix. This product is ready to sell.` | none; `showAnalyzeAgain: true` |
| `stale: true` | same label, `outlined: true` | `The product changed since this check.` | analyze, `Analyze again` |
| `lastFailed: true` | `LAST_RUN_FAILED_LABEL`, error | reason sentence | analyze, `Analyze again` |

  Row tests: the `price` row detail reads `Uses the market prices from {age}` when `refs.researchUpdatedAt` is set; the `prices` row value is `Start {amount}` from the stored estimate and is empty with status `idle` when there is none; the `suggestions` row value is the count and its detail `{n} waiting for you` or `None waiting`; during a run, rows whose check has no result are `running`.
- [ ] **Step 2: Run.** `npx jest hermesCardModel` — expected: FAIL, module not found.
- [ ] **Step 3: Implement `hermesCardState`.** The progress count is: finished research nodes (of 5) plus finished checks (of 3) plus one for the step in progress; total 8 when a research run is active or linked to the active verdict, otherwise 3.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(frontend): view model for the Hermes card`

### Task 5: The card, the drawer shell, Checks and Suggestions tabs, rail restructure

**Files:**
- Create: `src/frontend/components/product-detail/hermes/HermesCard.tsx`, `HermesDrawer.tsx`, `ChecksTab.tsx`, `SuggestionsTab.tsx`
- Modify: `src/frontend/pages/ListingDetailsPage.tsx` (rail, lines ~1310–1465; handlers `handleReviewPrice`, `handleAnalyzeWithHermes`)
- Modify: `src/frontend/components/product-detail/ProductDetailSections.tsx` (remove `ProductHermesCard`, `ProductActivityCard`, `productActivityItems` when unused; `PricingSummaryCard` gets an optional `hermesHint?: { text: string; onClick: () => void }`)
- Test: `src/frontend/components/product-detail/hermes/HermesCard.test.tsx` (`renderToStaticMarkup`)

**Interfaces:**
- Consumes: `hermesCardState`, `HermesDrawerTab`.
- Produces: `<HermesCard state={HermesCardState} analyzeDisabledReason={string | null} busy={boolean} onAnalyze onSetPrice(eventId) onOpen(tab) />`; `<HermesDrawer open tab onTabChange onClose title>{tab content}</HermesDrawer>`.
- Test ids: `hermes-card`, `hermes-chip`, `hermes-lead`, `hermes-primary-action`, `hermes-analyze-again`, `hermes-row-{key}`, `hermes-history-link`, `hermes-drawer`, `hermes-tab-{tab}`, `hermes-drawer-close`.

- [ ] **Step 1: Write the failing render tests.** `renders five rows with their test ids`; `a set_price state renders the primary label and the Analyze again button`; `analyzeDisabledReason is shown and disables the analyze button`; `the price row sits directly after the prices row` (order of test ids in the markup).
- [ ] **Step 2: Run.** `npx jest HermesCard` — expected: FAIL.
- [ ] **Step 3: Build `HermesCard`.** Layout as in the approved prototype: header with chip, lead, action row, rows as full-width buttons with a status mark, value and one detail line, a connector between the `prices` and `price` rows, footer with the history link. Card heading level follows the other rail cards.
- [ ] **Step 4: Build `HermesDrawer`.** MUI `Drawer` anchored right, width `min(560px, 100%)`, MUI `Tabs`, focus returns to the row that opened it, Esc closes.
- [ ] **Step 5: `ChecksTab` and `SuggestionsTab`.** `ChecksTab` lists the three checks with every reason, the price row's fix actions (`Set price to …`, and a link to the prices tab), and below them the existing `PublicationReadinessSection` with `ProductRecheckReview`. `SuggestionsTab` moves the existing `SeoRecommendationQueue` block with its loading, error and empty states unchanged.
- [ ] **Step 6: Restructure the rail.** Order: `PricingSummaryCard`, `OlxInsightsCard`, `HermesCard`. Remove `PriceResearchSection`, the "Sale verdict" card, `ProductHermesCard`, `ProductActivityCard` and `handleReviewPrice`. `onSetPrice` approves the event with the mutation `SeoRecommendationQueue` uses for Apply, then shows the existing success toast. The price card shows the hint `Hermes: 1 thing to fix` (count of checks not `ready`) that opens the Checks tab. Keep `ProductPriceDiscount` in the hero.
- [ ] **Step 7: Run** `npx jest HermesCard ListingDetailsPage ProductDetailSections`, `npm run type-check`, `npm run lint`. Expected: PASS; delete or rewrite tests of removed components, with the reason in the commit body.
- [ ] **Step 8: Commit.** `feat(product-page): one Hermes card with a details drawer`

### Task 6: Market prices tab with "Your prices"

**Files:**
- Create: `src/frontend/components/product-detail/hermes/PricesTab.tsx`, `myPricesModel.ts`
- Test: `src/frontend/components/product-detail/hermes/myPricesModel.test.ts`
- Modify: `src/frontend/components/product-detail/PriceResearchSection.tsx` (keep only `ProductPriceDiscount`; remove the editor and anchors), `priceResearchModel.ts` (drop what only the editor used)

**Interfaces:**
- Consumes: `useGetPriceResearchQuery`, the existing save and refresh mutations, `PriceResearchBody`.
- Produces:

```ts
export type MyPriceKind = 'same_model_used' | 'last_new_price' | 'substitute_new' | 'substitute_used';
export interface MyPriceInput { price: string; kind: MyPriceKind; url: string; seenAt: string }
export type MyPriceResult = { ok: true; body: PriceResearchBody } | { ok: false; field: 'price' | 'url' | 'seenAt' | 'form'; message: string };
export function addMyPrice(research: PriceResearch | null, input: MyPriceInput, currency: string): MyPriceResult;
export function removeMyPrice(research: PriceResearch, index: number | 'retail'): PriceResearchBody; // index into research.comparables
export interface MyPriceRow { index: number | 'retail'; kind: MyPriceKind; price: number; url: string | null; seenAt: string | null }
export function myPrices(research: PriceResearch | null): MyPriceRow[];
```
- Test ids: `prices-summary`, `prices-found-list`, `prices-search-again`, `my-prices-list`, `my-price-form`, `my-price-add`, `my-price-remove-{index}`, `my-price-error`.

- [ ] **Step 1: Write the failing tests.**
  - `kind last_new_price writes the retail fields and leaves comparables untouched` (retailPrice, retailCurrency = currency, retailCheckedAt = seenAt, retailSource = url or `manual`).
  - `the other kinds append a comparable with source 'manual', the tier, url and seenAt`; existing `auto` and `web` rows are in the body unchanged and in the same order.
  - `price '0', '-5', 'abc' and '10000000000' are rejected on field 'price'` with the existing `PRICE_ERROR` text; `'180,50'` is accepted as 180.5.
  - `a url longer than MAX_URL_LENGTH is rejected`; an empty url is accepted.
  - `a seenAt that is not an ISO date is rejected`.
  - `30 comparables: adding returns field 'form' with "30 prices is the limit. Remove one to add another."`
  - `myPrices lists the retail value as a 'retail' row and only source 'manual' comparables`.
  - `removeMyPrice('retail') clears the four retail fields`; removing an index drops only that comparable.
- [ ] **Step 2: Run.** `npx jest myPricesModel` — expected: FAIL.
- [ ] **Step 3: Implement the model.**
- [ ] **Step 4: Build `PricesTab`.** Four figures from the stored estimate (start, floor, new, used range) and one sentence on confidence; "Found by Hermes" list grouped by tier with links and the collapsed matching explanation (`specs`/class attributes); **Search again** (disabled with the PLN reason for a non-PLN listing, disabled while a run is active); "Your prices" list and a form — price, kind, optional link, date seen (defaults to today) — that saves on Add. On 409 keep the typed values and show the Review Focus message with a Reload action that refetches; other errors show the server message inline in `my-price-error`. An empty report shows one empty state with **Analyze product** and the form.
- [ ] **Step 5: Remove the old editor** and every export nothing imports any more; `npm run type-check`, `npm run lint`, `npx jest product-detail`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(product-page): market prices report with your own prices`

### Task 7: Log and history tab

**Files:**
- Create: `src/frontend/components/product-detail/hermes/HistoryTab.tsx`
- Test: `src/frontend/components/product-detail/hermes/HistoryTab.test.tsx`
- Modify: `src/frontend/pages/ListingDetailsPage.tsx` (queries, polling)

**Interfaces:**
- Consumes: `buildHistory`, `HistoryEntry`, the two list hooks, the product's Hermes events the page already loads.
- Test ids: `history-entry`, `history-entry-outcome`, `history-step`, `history-empty`, `history-show-more`.

- [ ] **Step 1: Write the failing render tests.** `an entry renders its title, starter, duration and outcome`; `the newest entry is expanded and lists its steps`; `no entries renders history-empty with "No runs yet. Every analysis and every price search will be listed here with its steps."`; `more than 10 entries render 10 and a Show more button`.
- [ ] **Step 2: Run.** `npx jest HistoryTab` — expected: FAIL.
- [ ] **Step 3: Build `HistoryTab`.** MUI `Accordion` per entry; dates through the page's existing date formatter; durations as `48 s` / `2 min 10 s`. The two list queries are skipped until the drawer has been opened once, and poll at the interval `useProductVerdict` uses while a run is active.
- [ ] **Step 4: Run** the test, `npm run type-check`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(product-page): run log and history in the Hermes drawer`

### Task 8: Live UI tests and final verification

**Files:**
- Modify: `test-automation/src/main/java/dev/quokkify/marketdesk/page/ProductDetailPage.java`, `step/ProductDetailPageSteps.java`, `verification/ProductDetailPageVerification.java`
- Modify: `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/PriceResearchUiTest.java`, `SaleVerdictUiTest.java`
- Create: `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/HermesCardUiTest.java`
- Modify: `docs/` page that describes the product page AI blocks, if one names the removed cards

- [ ] **Step 1: Page object.** Elements by the test ids of Tasks 5–7, declared with `@FindBy` like the existing static buttons; the drawer is found as the visible dialog, not the phone sidebar drawer.
- [ ] **Step 2: Write `HermesCardUiTest`.**
  - `newProductOffersAnalyze`: chip `Not analysed`, primary `Analyze product`.
  - `overpricedProductOffersSetPrice`: after an analysis of a product priced above its ceiling, the lead names both prices; clicking the primary action changes the product price and the chip leaves `Not ready`.
  - `rowsOpenTheirTabs`: each of the five rows opens the drawer on its tab; Esc closes it.
  - `ownPriceSurvivesSearchAgain`: add a price in "Your prices", press Search again, wait for the run, the price is still listed.
  - `historyListsTheAnalysis`: after one analysis the history has at least one entry whose steps include `Price check`.
  - `railHasNoOldCards`: no element with the old `review-price-button` or `verdict-summary` test ids on the page.
- [ ] **Step 3: Adapt `PriceResearchUiTest` and `SaleVerdictUiTest`** to the new elements; a test whose subject no longer exists (the inline editor) is deleted with the reason in the commit body.
- [ ] **Step 4: Run everything.** `npm run lint && npm run type-check && npx jest --ci --forceExit` (with `SKIP_REDIS_TESTS=true` when port 6379 belongs to another stack); then the q4j suite against an isolated Compose stand of this branch: `JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew test` in `test-automation`. Expected: all green. Paths that need real OLX search results are checked by hand on the stand and listed in the PR test plan.
- [ ] **Step 5: Check the page by eye** on the stand at 1568, 1024 and 390 px wide, light and dark: the rail is shorter than before, the drawer is full-width on the phone, no horizontal scroll.
- [ ] **Step 6: Scan the changed files** for placeholder notes, skipped or focused tests and unimplemented branches; fix or report each.
- [ ] **Step 7: Commit.** `test: live checks for the Hermes card and drawer`
