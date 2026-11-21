# Revive Expired OLX Advert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One screen per expired OLX advert: missing facts + Hermes title/description/price proposals, one click applies the ticked changes, updates the advert on OLX and reactivates it; publishing with condition `unknown` is refused.

**Architecture:** A new `revive` kind in `ProductAssistanceGraph` builds a review-only proposal (rules → existing Hermes `improve` calls → price guard). A `ListingRevivalService` applies it: validate → stale check → save product and listing price → `adapter.updateListing` (PUT) → `ListingReactivationService.reactivate`. The product page opens a revival dialog from a new primary action.

**Tech Stack:** Express, LangGraph (`@langchain/langgraph`), zod, pg; React + MUI + RTK Query; q4j (TestNG, RestAssured, Selenide, q4j-sql) in `test-automation`.

**Spec:** `docs/superpowers/specs/2026-11-21-revive-expired-advert-design.md`

## Global Constraints

- Tests: live q4j tests in `test-automation` against the branch Compose stack; no new Jest tests with mocks (pure-function Jest tests are allowed).
- Nothing reaches OLX before the owner's apply click; no paid OLX action; cost price and condition are never guessed.
- Condition values: `new | like_new | good | fair | poor | refurbished | unknown`; `unknown` is refused for new publish, relist and revive apply, never for updates of live adverts.
- Refusal copy verbatim: `Choose the product's condition before publishing to OLX`.
- UI copy verbatim: primary action `Revive on OLX`; secondary `Reactivate on OLX`; apply button `Apply and bring back on OLX`; below-cost checkbox `Sell below cost`.
- Activity action verbatim: `olx.advert_revived`.
- Apply order is one code constant, default `update-then-activate`; the alternative `activate-then-update` must work by flipping it.
- Every apply response, success or step failure, returns fresh `productUpdatedAt` and `listingUpdatedAt`.
- Request order for apply: auth 401 → listing/product of the workspace 404 → body validation 400 → stale timestamps 409 → state 422 (not expired, no OLX advert id, sandbox, below cost without `allowBelowCost`).
- Public repo: no secrets, internal URLs or machine paths.

## Review Focus

1. Hermes is offline or rejects → the proposal still returns missing facts and the price guard, with no copy/price proposals and `aiUsage.provider` `offline`/`none`, never a 500.
2. OLX refuses the update (4xx) in the default order → nothing is reactivated, saved product changes stay, the error names the "update" step and carries OLX's reason, fresh timestamps are returned.
3. A price below a known cost price without `allowBelowCost` → 422 and nothing saved or sent.
4. Two applies in quick succession → the second sees changed timestamps (409) or a non-expired listing (422); never a double activate after a successful revive.
5. A live imported product with condition `unknown` (the projector) → Hermes-approved price/title updates still succeed; only new publish/relist/revive refuse.

---

### Task 1: Refuse publishing with condition `unknown`

**Files:** modify `src/backend/application/usecases/PublishListingUseCase.ts` (`evaluatePublishEligibility`), `src/backend/infrastructure/adapters/OLXAdapter.ts` (create-only backstop in `doPublish`/`preparePublish`), the product page publish review if it lists eligibility warnings; q4j `test-automation/.../test/api/PublishConditionTest.java` (+ steps/service as the layout requires).

**Interfaces:** `evaluatePublishEligibility(listing, product, marketplace)` returns `canPublish: false` with error `ValidationError('Choose the product\'s condition before publishing to OLX')` when `marketplace.key === 'olx'` and `product.condition === 'unknown'`. The adapter backstop throws the same message for a create (POST) with condition `unknown`; `updateListing` is untouched.

- [ ] **Step 1: Failing q4j test** `refusesPublishingAProductWithUnknownCondition`: register, connect sandbox OLX, create product with `condition: "unknown"` + OLX listing, `POST /api/listings/{id}/publish` → 400 `VALIDATION_ERROR` with the verbatim message; `publishesAProductWithAKnownCondition` stays as the guard (same flow with `good` → not 400).
- [ ] **Step 2: Run** on the branch stack `./gradlew apiTest --tests '*PublishConditionTest'` → FAIL.
- [ ] **Step 3: Implement** eligibility rule + adapter backstop.
- [ ] **Step 4: Run** → PASS; full `npm test` (SKIP_REDIS_TESTS=true), type-check, lint.
- [ ] **Step 5: Commit** `fix(olx): ask for the product's condition before publishing to OLX`.

### Task 2: Revival proposal (graph `revive` + endpoint)

**Files:** create `src/backend/domain/services/revivalRules.ts` (+ pure `revivalRules.test.ts`); modify `src/backend/application/services/ProductAssistanceGraph.ts`, `ListingController.ts`, `routes/listings.ts`, `src/shared/types/index.ts`, container/app wiring as needed; q4j: `helper/DatabaseHelper` (q4j-sql, config keys `MARKETDESK_DB_URL`, `MARKETDESK_DB_USER`, `MARKETDESK_DB_PASSWORD` with defaults matching the CI stack: `jdbc:postgresql://127.0.0.1:5432/<db name from .env.example>`, user/password from `.env.example` / `scripts/ci-java-api-tests.sh`; forwarded in `gradle/tests.gradle`), `RevivalTest.java`.

**Interfaces:**
- `missingFacts(product): Array<{ field: 'condition' | 'costPrice'; required: boolean; note: string }>` — condition `unknown` → required; `costPrice === null` → optional with note `Without a cost price the price floor cannot be checked`.
- `priceGuard(proposedPrice: number | null, costPrice: number | null): { status: 'ok' | 'below_cost' | 'unchecked' | 'no_proposal'; costPrice: number | null }`.
- Graph input kind `revive` `{ workspaceId, listingId }`; output `RevivalProposal = { listingId; productId; productUpdatedAt; listingUpdatedAt; missingFacts; title?: { current; proposed; rationale }; description?: { current; proposed; rationale }; price?: { current; proposed; currency; rationale }; priceGuard; aiUsage }` (first `title` and first `description` recommendation).
- `POST /api/listings/:id/revival-proposal` (aiLimiter like improvements) → `RevivalProposal`; 404 other workspace / unknown; 422 `Only an expired listing with an OLX advert can be revived` otherwise. Allowed in sandbox (it touches no marketplace).

- [ ] **Step 1: Failing tests.** Pure Jest for `missingFacts` / `priceGuard` (all statuses). q4j `RevivalTest`: `proposalListsMissingConditionForAnExpiredListing` (create product `condition: unknown`, `costPrice: null`, listing; DatabaseHelper sets the listing `status='expired'`, `marketplace_listing_id='qa-olx-<uuid>'`; proposal → `missingFacts` contains condition required and costPrice optional, `priceGuard.status` in [`unchecked`,`no_proposal`], `aiUsage.provider` `offline`); `proposalRefusesALiveOrDraftListing` (422); `proposalHidesAnotherWorkspaceListing` (404); `proposalRequiresLogin` (401).
- [ ] **Step 2: Run** → FAIL (404 route / module missing).
- [ ] **Step 3: Implement** rules, graph kind (reuse the `improve` Hermes calls inside the same `aiUsage` scope with feature `revive`), endpoint.
- [ ] **Step 4: Run** → PASS; full `npm test`, type-check, lint, q4j static checks.
- [ ] **Step 5: Commit** `feat(olx): propose what to change before reviving an expired advert`.

### Task 3: Apply a revival

**Files:** create `src/backend/application/services/ListingRevivalService.ts`; modify `ListingController.ts`, `routes/listings.ts`, `validation/schemas.ts`, container; q4j additions in `RevivalTest`.

**Interfaces:**
- Body schema (strict): `{ condition: <condition enum>, costPrice?: number >= 0, title?: string 1..200, description?: string 1..9000, price?: number > 0, allowBelowCost?: boolean, productUpdatedAt: ISO string, listingUpdatedAt: ISO string }`; `condition: unknown` → 400 (the verbatim refusal message).
- `REVIVAL_APPLY_ORDER: 'update-then-activate' | 'activate-then-update'` constant = `'update-then-activate'`.
- `ListingRevivalService.revive(input) → { outcome: ReactivationOutcome | 'update_refused'; step: 'update' | 'activate' | 'done'; reason: string | null; listing; productUpdatedAt; listingUpdatedAt }` — saves product (condition, costPrice, name/description) and listing price first, then the two OLX steps in the configured order via `adapter.updateListing(externalId, changes, currentPublishInput)` (built the way publishing builds `ListingPublishInput`) and `ListingReactivationService.reactivate`; OLX errors map like reactivation's `providerFailure`; activity `olx.advert_revived` with changed fields, outcome, step.
- `POST /api/listings/:id/revive` (sensitiveLimiter) → that result; 200 for done or reported step failure, error codes per Global Constraints for refusals.

- [ ] **Step 1: Failing q4j tests:** `reviveRefusesUnknownCondition` (400 verbatim), `reviveRefusesStaleTimestamps` (expired seeded listing, old `productUpdatedAt` → 409), `reviveRefusesInSandbox` (fresh timestamps → 422 sandbox), `reviveRefusesBelowCostWithoutConfirmation` (costPrice 100, price 50 → 422, product unchanged on GET), `reviveHidesAnotherWorkspaceListing` (404), `reviveRequiresLogin` (401).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; full `npm test`, type-check, lint, full q4j `apiTest`.
- [ ] **Step 5: Commit** `feat(olx): apply the chosen changes and bring an expired advert back`.

### Task 4: Revival dialog on the product page

**Files:** modify `src/frontend/state/api/listingsApi.ts` (+ hooks), `src/frontend/pages/ListingDetailsPage.tsx` (`productPrimaryAction` returns `revive` where it returned `reactivate`; keep `Reactivate on OLX` as a secondary action), `src/frontend/components/product-detail/ProductDetailSections.tsx`; create `src/frontend/components/product-detail/RevivalDialog.tsx` and pure `revivalView.ts` (+ test); q4j page objects + `RevivalUiTest`.

**Interfaces:** `revivalView(proposal, form)` → `{ canApply: boolean; reasons: string[]; priceRow: { show; checkedByDefault; needsBelowCostConfirmation } }` (canApply false while condition is `unknown`); RTK `getRevivalProposal` (mutation, no cache) and `reviveListing` (invalidates Listing/Product/AiUsage tags); toasts reuse `reactivationToast` outcomes plus `update_refused` with OLX's reason.

- [ ] **Step 1: Failing q4j UI tests** (expired listing seeded via DatabaseHelper): `productPageOffersReviveForAnExpiredAdvert` (button `Revive on OLX` visible, `Reactivate on OLX` present as secondary); `reviveDialogNeedsACondition` (dialog shows the condition select and the apply button is disabled; choosing `good` enables it — do not click apply on the stub stack).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `./gradlew apiTest uiTest`, `npm test`, type-check, lint, build → green.
- [ ] **Step 5: Commit** `feat(olx): add the revival dialog to the product page`.

### After merge (controller)

- [ ] Deploy; try on one product (AirPods) with the owner, watching logs: verify OLX accepts the update (images, location, contact unchanged on olx.pl) and the order; flip `REVIVAL_APPLY_ORDER` in a follow-up if OLX refuses PUT on outdated adverts.
- [ ] Open the GitHub issue for the autopilot version of revival (owner request).
