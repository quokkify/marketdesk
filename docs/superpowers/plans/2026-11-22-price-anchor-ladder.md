# Price Anchor Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent finds labelled price anchors (same model used, last new price, new and used substitutes) on its own, saves them, and caps the start price at 70 % of the cheapest new substitutes, so items no longer sold new get a usable proposal.

**Architecture:** One web-research call on the `marketdesk-research` profile returns specs plus tiered anchors; a pure filter keeps only allowlisted, valid rows, which replace earlier automatic rows in `product_price_research` (seller deletions are remembered per URL). The Hermes engine refreshes stale research before estimating, clamps the estimate with a pure ceiling function, and stores the last estimate with the reason it was not raised as a suggestion. The product page shows anchors grouped by tier plus the stored estimate.

**Tech Stack:** TypeScript, Express, PostgreSQL (JSONB), React + RTK Query, Jest for pure functions, q4j (Java 21, TestNG) for live API/UI tests.

**Spec:** `docs/superpowers/specs/2026-11-22-price-anchor-ladder-design.md`

## Global Constraints

- Ceiling: `startPrice <= 0.70 × median(three cheapest substitute_new prices)`; fewer rows → median of what there is; none → no substitute cap. Lowest `last_new_price` is a second cap; the seller's retail price stays a cap; the lowest cap applies.
- Confidence cap from tiers: any `same_model_used` row → `high`; at least two substitute rows (new + used together) → `medium`; otherwise `low`. Final confidence = the lower of the model's and the tier cap.
- Freshness: refresh only when `last_attempt_at` is null or older than 7 days; the attempt time is recorded on success, empty result and failure.
- Research profile must enable exactly the `web` toolset (`isResearchToolsetSafe`), checked before every call. Only `sanitizeSearchName` output, condition, category and currency reach the research prompt.
- Currency: PLN listings only (as today, `SEARCH_NEEDS_PLN`).
- Migrations replay on every start: `ADD COLUMN IF NOT EXISTS`, never `DROP`; mirror columns in `schema.sql`.
- Price changes still require confirmation; nothing here applies a price.
- Tests: pure functions in Jest without mocks; behaviour through the running app in q4j (`test-automation`, `JAVA_HOME` = Homebrew openjdk@21, `./gradlew apiTest` / `uiTest`) against an isolated Compose stand. CI has no research profile, so real web-research success is checked by hand on prod and stated in the PR.
- Existing Jest tests get only the edits needed to keep compiling (`ComparableSearchService` tests are deleted with the service).

## Review Focus

1. The model reports an anchor in EUR, with a price as a string, or on a non-allowlisted host → the row is dropped silently, the rest is kept (Task 2 test `drops rows with wrong currency, type or host`).
2. Nothing is found → `last_attempt_at` is still set and a second estimate within 7 days does not search again (Task 3 test `isResearchFresh`, Task 3 q4j run twice).
3. The seller deletes an automatic row, then adds the same URL as a manual row → the manual row is kept; the tombstone only blocks automatic rows (Task 1 test `dismissedAfterEdit ignores manual rows`, Task 2 test `skips dismissed URLs`).
4. Only one or two `substitute_new` rows, or a single absurdly cheap one among three → median of what there is (Task 4 tests `substituteNewReference`).
5. Research saved before this change (rows without `tier`) → counted as `same_model_used` for confidence and as used comparables for `usedRange` (Task 4 test `untiered rows count as same model used`).

---

### Task 1: Storage, URL allowlist and seller deletions

**Files:**
- Modify: `src/shared/types/index.ts:102-143`
- Create: `src/shared/anchorUrl.ts`, `src/shared/__tests__/anchorUrl.test.ts`
- Create: `src/backend/persistence/migrations/051_price_research_ladder.sql`; Modify: `src/backend/persistence/schema.sql:486-495`
- Modify: `src/backend/infrastructure/persistence/repositories/PriceResearchRepository.ts`, `src/backend/domain/repositories/interfaces/IPriceResearchRepository.ts`
- Create: `src/backend/domain/services/priceResearchEdit.ts`, `src/backend/domain/services/__tests__/priceResearchEdit.test.ts`
- Modify: `src/backend/presentation/http/validation/schemas.ts:138-178`, `src/backend/presentation/http/controllers/ProductController.ts` (`putPriceResearch`)
- Test (q4j): `test-automation/.../test/api/PriceResearchTest.java`, `model/PriceResearchPojo.java`, `verification/PriceResearchVerification.java`

**Interfaces:**
- Produces (shared types):
  ```ts
  export type AnchorTier = 'same_model_used' | 'last_new_price' | 'substitute_new' | 'substitute_used';
  export type PriceComparableSource = 'manual' | 'web' | 'auto';
  // PriceComparable gains: tier?: AnchorTier | null; seenAt?: string | null  (ISO date)
  export type EstimateHiddenReason = 'low_confidence' | 'within_threshold' | 'floor_cancels';
  export interface StoredPriceEstimate {
    estimate: PriceEstimate; estimatedAt: string; hiddenReason: EstimateHiddenReason | null; researchNote: string | null;
  }
  // PriceResearch gains: specs: string | null; dismissedUrls: string[]; lastAttemptAt: string | null; lastEstimate: StoredPriceEstimate | null
  ```
- Produces: `normalizeAnchorUrl(url: string): string | null` and `ANCHOR_HOSTS: readonly string[]` in `src/shared/anchorUrl.ts`.
- Produces repository methods: `upsert(workspaceId, research: Omit<PriceResearch, 'updatedAt' | 'specs' | 'lastAttemptAt' | 'lastEstimate'>)` (now writes `dismissed_urls`), `saveLadder(workspaceId, productId, { comparables, specs, attemptedAt }): Promise<PriceResearch>` (creates the row if missing), `markAttempt(workspaceId, productId, attemptedAt: string): Promise<void>`, `saveEstimate(workspaceId, productId, stored: StoredPriceEstimate): Promise<void>`.
- Produces: `dismissedAfterEdit(before: PriceComparable[], after: PriceComparable[], dismissed: string[]): string[]` in `priceResearchEdit.ts`.

- [ ] **Step 1: Write failing Jest tests**
  - `anchorUrl.test.ts`: `normalizeAnchorUrl('https://www.olx.pl/d/oferta/x-CID1-ID9.html?r=1')` equals `normalizeOlxAdvertUrl` of the same; `https://allegro.pl/oferta/projektor-123?bi_s=x#a` → `https://allegro.pl/oferta/projektor-123`; `https://www.ceneo.pl/123` → same without query; `http://allegro.pl/x` → null; `https://evil.example/allegro.pl` → null; `https://allegro.pl.evil.com/x` → null.
  - `priceResearchEdit.test.ts`: removing an `auto` row adds its normalized URL; removing a `manual` or `web` row adds nothing; `dismissedAfterEdit ignores manual rows` (an auto row removed and the same URL re-added as manual → URL still dismissed, manual row untouched); duplicates are not added twice.
- [ ] **Step 2: Run** `npx jest src/shared/__tests__/anchorUrl.test.ts src/backend/domain/services/__tests__/priceResearchEdit.test.ts` — expected FAIL (modules missing).
- [ ] **Step 3: Implement** types, `anchorUrl.ts` (https only; host equals or ends with `.`+ an entry of `ANCHOR_HOSTS = ['olx.pl', 'allegro.pl', 'allegrolokalnie.pl', 'ceneo.pl', 'x-kom.pl', 'komputronik.pl', 'mediaexpert.pl', 'euro.com.pl', 'mediamarkt.pl', 'morele.net', 'amazon.pl']`; OLX delegates to `normalizeOlxAdvertUrl`; others drop query and hash), and `dismissedAfterEdit`.
- [ ] **Step 4: Migration 051** adds to `product_price_research`: `specs VARCHAR(300)`, `dismissed_urls JSONB NOT NULL DEFAULT '[]'::jsonb`, `last_attempt_at TIMESTAMP`, `last_estimate JSONB`, each `ADD COLUMN IF NOT EXISTS`; same columns in `schema.sql`. Repository reads them (`last_attempt_at` as ISO string) and gains the three methods above. `saveLadder` and `markAttempt` leave retail fields and manual rows alone (the caller passes the merged list).
- [ ] **Step 5: PUT validation and dismissal.** `priceComparableSchema` accepts `source: 'auto'` with `tier` (enum) and `seenAt` (ISO date); an `auto` row needs `normalizeAnchorUrl(url) !== null`; `MAX_COMPARABLES` becomes 30 here and in `priceResearchModel.ts`. `putPriceResearch` loads the stored research, computes `dismissedAfterEdit(stored.comparables, body.comparables, stored.dismissedUrls)` and passes it to `upsert`. `dismissedUrls` is not accepted from the body.
- [ ] **Step 6: Run** the Jest tests from Step 2 and `npm run type-check` — expected PASS.
- [ ] **Step 7: q4j API tests** in `PriceResearchTest`: `putAcceptsAutoRowWithTier` (PUT an auto row `tier=substitute_new`, allegro URL → GET returns tier, seenAt, source `auto`); `deletingAutoRowRecordsDismissal` (PUT with the row, PUT without it → GET `dismissedUrls` holds its normalized URL); `autoRowOnUnknownHostIs400`; `dismissedUrlsInBodyIs400` (strict schema). Run `./gradlew apiTest --tests '*PriceResearchTest*'` against the stand — expected PASS.
- [ ] **Step 8: Commit** `feat(pricing): store tiered price anchors and seller dismissals`

### Task 2: Ladder prompt, parser, filter and merge

**Files:**
- Create: `src/backend/infrastructure/external/anchorLadderPrompt.ts`, `src/backend/infrastructure/external/__tests__/anchorLadderPrompt.test.ts`
- Create: `src/backend/domain/services/anchorLadder.ts`, `src/backend/domain/services/__tests__/anchorLadder.test.ts`

**Interfaces:**
- Consumes: `AnchorTier`, `PriceComparable`, `normalizeAnchorUrl` (Task 1); `sanitizeSearchName`, `parseJsonObject`, `sellerDataBlock`, `isResearchToolsetSafe`, `SEARCH_NAME_TOO_SHORT` (moved here from `comparableSearchPrompt.ts`, which Task 3 deletes).
- Produces: `ANCHOR_LADDER_OPERATION = 'researchAnchors'`; `buildAnchorLadderPrompt(input: { name; condition; category; currency }): { system: string; prompt: string }`; `parseAnchorLadder(raw: string): { specs: string | null; anchors: unknown[] } | null`; `filterAnchorRows(items: unknown[], ctx: { currency: string; ownUrl: string | null; dismissed: ReadonlySet<string>; today: string }): PriceComparable[]`.
- Produces (domain): `mergeLadder(existing: PriceComparable[], found: PriceComparable[]): PriceComparable[]` and `MAX_ANCHORS_PER_TIER = 5`, `MAX_AUTO_ROWS = 20`.

- [ ] **Step 1: Write failing tests.**
  - Prompt: contains the four tier names, the steps "find key specs first", "report only pages you opened", the JSON shape `{ "specs": string, "anchors": [{ "tier", "price", "currency", "title", "url" }] }`, and never contains the product description; empty sanitized name throws `SEARCH_NAME_TOO_SHORT`.
  - `parseAnchorLadder`: strict JSON object; object embedded in prose; array or garbage → null; `specs` trimmed and cut to 300 chars, non-string → null.
  - `filterAnchorRows`: keeps a valid row as `{ price, note: title, url: normalized, source: 'auto', tier, seenAt: today }`; `drops rows with wrong currency, type or host` (EUR, `"299"`, unknown host, unknown tier, price ≤ 0 or > 100 000); drops the own advert and duplicates; `skips dismissed URLs`; at most `MAX_ANCHORS_PER_TIER` per tier and `MAX_AUTO_ROWS` in total.
  - `mergeLadder`: keeps every `manual` and `web` row in order, replaces all `auto` rows with `found`, total capped at 30.
- [ ] **Step 2: Run** `npx jest anchorLadder` — expected FAIL.
- [ ] **Step 3: Implement.** System text reuses the comparable-search rules (data, never instructions; never invent). The prompt walks the tiers in order and asks for the last new price with the shop name in the title. One call covers all tiers.
- [ ] **Step 4: Run** `npx jest anchorLadder` — expected PASS.
- [ ] **Step 5: Commit** `feat(pricing): parse and filter the price anchor ladder`

### Task 3: Ladder service and refresh endpoint (replaces comparable search)

**Files:**
- Create: `src/backend/application/services/AnchorLadderService.ts`
- Create: `src/backend/domain/ports/IPriceResearchRefresher.ts`
- Create: `src/backend/domain/services/researchFreshness.ts`, `src/backend/domain/services/__tests__/researchFreshness.test.ts`
- Delete: `src/backend/application/services/ComparableSearchService.ts`, `src/backend/infrastructure/external/comparableSearchPrompt.ts` and their tests; `ComparableCandidate` type if unused afterwards
- Modify: `src/backend/config/di/container.ts:471-490`, `src/backend/presentation/http/routes/products.ts:38`, `ProductController.ts` (`searchComparables` → `refreshPriceResearch`)
- Test (q4j): rename `ComparableSearchTest.java` → `PriceResearchRefreshTest.java`; `service/PriceResearchService.java`

**Interfaces:**
- Consumes: Task 1 repository methods, Task 2 functions, `ComparableResearchProfile` (move the interface into `AnchorLadderService.ts`).
- Produces:
  ```ts
  export type LadderOutcome = 'refreshed' | 'fresh' | 'not_configured' | 'not_pln' | 'unavailable';
  export interface IPriceResearchRefresher {
    refreshIfStale(workspaceId: string, productId: string): Promise<LadderOutcome>;
  }
  // AnchorLadderService implements it and adds:
  refresh(workspaceId: string, productId: string): Promise<PriceResearch>; // forced; throws like the old search
  ```
  `isResearchFresh(lastAttemptAt: string | null, now: Date): boolean` with `RESEARCH_MAX_AGE_DAYS = 7`.
- Route: `POST /api/products/:id/price-research/refresh` (keeps `aiLimiter`) → 200 `PriceResearch`. `/search` is removed.

- [ ] **Step 1: Failing Jest** `isResearchFresh`: null → false; 6 days 23 h ago → true; exactly 7 days → false.
- [ ] **Step 2: Run** `npx jest researchFreshness` — FAIL; implement; run — PASS.
- [ ] **Step 3: Implement `AnchorLadderService`.** `refresh`: 404 for another workspace's product, then `SEARCH_NOT_CONFIGURED` (503), `SEARCH_NEEDS_PLN` (400), profile reachable and toolset safe (503), call under `withAiUsageScope({ feature: 'research' })` + `withAiOperation(ANCHOR_LADDER_OPERATION)`, parse (unusable → 502 `SEARCH_UNUSABLE`), filter with `dismissed` from storage, `mergeLadder`, `saveLadder`. Once the configuration and currency checks pass, every path records the attempt (`markAttempt` on any later failure); `not_configured` and `not_pln` record nothing, since no call was made. `refreshIfStale` returns `fresh` when `isResearchFresh`, otherwise runs `refresh` and maps errors to outcomes (`ServiceUnavailableError` with `SEARCH_NOT_CONFIGURED` → `not_configured`, `SEARCH_NEEDS_PLN` → `not_pln`, anything else → `unavailable`); it never throws.
- [ ] **Step 4: Wire DI and route;** delete the old service, prompt and tests. Run `npm run type-check && npx jest --forceExit` (with `SKIP_REDIS_TESTS=true`) — expected PASS.
- [ ] **Step 5: q4j** `PriceResearchRefreshTest`: `refreshWithoutResearchProfileIsNotConfigured` (503, message `Market search is not configured`), `otherWorkspaceRefreshIs404`, `refreshRequiresLogin`, `notConfiguredDoesNotTouchResearch` (GET research unchanged after the 503). Run `./gradlew apiTest --tests '*PriceResearchRefreshTest*'` — PASS.
- [ ] **Step 6: Commit** `feat(pricing): research the price anchor ladder in one web call`

### Task 4: Ceiling, tier confidence and engine wiring

**Files:**
- Modify: `src/backend/domain/services/priceEstimate.ts`, `src/backend/domain/services/__tests__/priceEstimate.test.ts`
- Modify: `src/backend/infrastructure/external/priceEstimatePrompt.ts`, its test
- Modify: `src/backend/domain/services/HermesDecisionEngine.ts:84-108,497-560`, constructor; `container.ts`
- Test (q4j): `PriceResearchTest.java` (or new `PriceEstimateLadderTest.java`), `PriceResearchSteps.java`

**Interfaces:**
- Consumes: `IPriceResearchRefresher` (Task 3), `saveEstimate` (Task 1).
- Produces in `priceEstimate.ts`:
  ```ts
  export const SUBSTITUTE_CEILING_RATIO = 0.7;
  export function substituteNewReference(rows: readonly PriceComparable[]): number | null;
  export function startPriceCeiling(rows: readonly PriceComparable[], researchAnchor: number | null): number | null;
  export function tierConfidence(rows: readonly PriceComparable[]): PriceEstimate['confidence'];
  export function applyLadderRules(e: PriceEstimate, rows: readonly PriceComparable[], researchAnchor: number | null): PriceEstimate;
  export function estimateHiddenReason(e: PriceEstimate, currentPrice: number): EstimateHiddenReason | null; // low_confidence | within_threshold | null
  ```
  `applyLadderRules`: `startPrice = min(startPrice, floorToCents(ceiling))`, `floorPrice = min(floorPrice, startPrice)`, confidence = lower of model and `tierConfidence`. Untiered rows count as `same_model_used`.
- Engine constructor gains `private readonly researchRefresher: IPriceResearchRefresher | null` (after `priceResearchRepo`).

- [ ] **Step 1: Failing Jest tests** in `priceEstimate.test.ts`: `substituteNewReference` → 280/300/320 → 300; 300/320 → 310; 300 → 300; 50/300/320/400 → 300 (three cheapest are 50, 300, 320, median 300); none → null. `startPriceCeiling` → refs above give 210; with `last_new_price` 799 → 210; with `last_new_price` 180 → 180; with seller retail 150 → 150; no caps → null. `applyLadderRules` on start 299 / floor 250 with 280/300/320 → start 210, floor 210. `tierConfidence`: one `same_model_used` → high; `substitute_new` + `substitute_used` → medium; one substitute → low; `untiered rows count as same model used`. `estimateHiddenReason`: low → `low_confidence`; 4.9 % difference → `within_threshold`; 5 % → null.
- [ ] **Step 2: Run** `npx jest priceEstimate` — FAIL; implement; run — PASS.
- [ ] **Step 3: Prompt.** `buildPriceEstimatePrompt` passes `specs` and comparables grouped by tier inside `sellerDataBlock`, and states the rules: start below 70 % of the cheapest new substitutes and below the last new price, the server enforces it; `last_new_price` is history, not the target. Update the prompt test to assert those lines and that tiers appear.
- [ ] **Step 4: Engine.** In `priceEstimateSuggestion`: call `researchRefresher?.refreshIfStale(...)` first (outcome `unavailable` → `researchNote = 'Market research failed; the estimate uses saved data.'`, `not_configured`/`not_pln` → null note); read research after it; after `validatePriceEstimate` apply `applyLadderRules`; restrict `labelEstimateFigures` used-price set to `same_model_used`, `substitute_used` and untiered rows; compute the hidden reason (`floor_cancels` where the existing floor logic returns null, else `estimateHiddenReason`); `saveEstimate` before returning (also when returning null). Seller floor is applied after the ceiling and wins.
- [ ] **Step 5: Run** `npm run type-check && npx jest --forceExit` — PASS.
- [ ] **Step 6: q4j** (CI stand: offline estimate provider, no research profile): `runStoresLastEstimate` (POST `/api/hermes/products/{id}/run` → GET research has `lastEstimate` with `estimatedAt`); `substituteCeilingCapsStartPrice` (PUT auto rows `substitute_new` 280/300/320 on allegro URLs, product price 299, run → `lastEstimate.estimate.startPrice <= 210`); `hiddenEstimateHasReason` (product priced so the estimate is within 5 % or low → `hiddenReason` not null). Run `./gradlew apiTest --tests '*PriceEstimateLadderTest*'` — PASS.
- [ ] **Step 7: Commit** `feat(pricing): cap the start price by new substitutes and keep the last estimate`

### Task 5: Product page: anchors by tier and the stored estimate

**Files:**
- Modify: `src/frontend/components/product-detail/priceResearchModel.ts`, `priceResearchModel.test.ts`
- Modify: `src/frontend/components/product-detail/PriceResearchSection.tsx`
- Delete: `src/frontend/components/product-detail/ComparableSearchDialog.tsx`; remove `mergeFoundComparables`, `selectionFits` and their tests
- Modify: `src/frontend/state/api/productsApi.ts` (search mutation → `refreshPriceResearch`, invalidates the research tag)
- Test (q4j UI): `PriceResearchUiTest.java`, `page/ProductDetailPage.java`, `step/ProductDetailPageSteps.java`

**Interfaces:**
- Consumes: `PriceResearch` fields from Task 1, refresh route from Task 3.
- Produces:
  ```ts
  export interface AnchorTierLine { tier: AnchorTier; label: string; text: string; rows: PriceComparable[] }
  export function anchorTierLines(r: PriceResearch | null, currency: string): AnchorTierLine[]; // always 4, fixed order
  export function storedEstimateLines(s: StoredPriceEstimate | null, currency: string): string[];
  ```
- Copy (exact): labels `Same model, used`, `Last new price`, `New substitutes`, `Used substitutes`; empty tier `not found`; tier text `from 280 zł (3)` for new substitutes, `250–300 zł (5)` for used tiers, `799 zł · Komputronik` for last new price (note of the cheapest row); hidden reasons `Not suggested: confidence is low.`, `Not suggested: within 5 % of the current price.`, `Not suggested: your lowest acceptable price blocks this change.`; specs line `Matched by: <specs>` when `specs` is set; button `Find prices`; header `Price anchors` with `updated <date>` from `lastAttemptAt`.

- [ ] **Step 1: Failing Jest tests** (pure, `renderToStaticMarkup` only where markup matters): `anchorTierLines` order and copy for the QH11 example (no same-model rows → `not found`; substitutes 280/300/320 → `from 280 zł (3)`); untiered rows go to `Same model, used`; `storedEstimateLines` appends the hidden reason and the research note.
- [ ] **Step 2: Run** `npx jest priceResearchModel` — FAIL; implement; run — PASS.
- [ ] **Step 3: Section.** Render the four tier lines with links (`target="_blank" rel="noopener noreferrer"`) above the existing form; `Find prices` calls the refresh mutation and shows the server error text on 503/502; the stored estimate replaces the old on-demand estimate lines; deleting an auto row uses the existing row-remove + save. Remove the dialog.
- [ ] **Step 4: Run** `npm run type-check && npx jest priceResearchModel && npm run build` — PASS.
- [ ] **Step 5: q4j UI** `anchorsGroupedByTier` (seed auto rows via API, open product page → four tier lines with the copy above, `Same model, used` shows `not found`); `findPricesShowsNotConfigured` (click `Find prices` on the CI stand → `Market search is not configured`). Run `./gradlew uiTest --tests '*PriceResearchUiTest*'` — PASS.
- [ ] **Step 6: Commit** `feat(ui): show price anchors by tier and the last estimate`

### After all tasks

- [ ] Whole-branch review, then PR into `main` with a test plan; state that real web-research success and the QH11 case are checked by hand on prod after deploy (research profile `marketdesk-research`).
