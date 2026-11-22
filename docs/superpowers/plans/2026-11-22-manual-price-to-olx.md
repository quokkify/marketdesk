# Manual Price To OLX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every manual price change (listing price dialog, Edit product) updates the product, all its listings, price history and queues the OLX update for live listings, exactly like a Hermes approval.

**Architecture:** Extract the Hermes approval's price apply + marketplace-update enqueue into a `PriceChangeService` (enqueue part as a reusable `MarketplaceUpdateEnqueuer`). The approval, `PATCH /listings/:id` (price) and `PATCH /products/:id` (sellingPrice) call it; responses carry a `priceSync` summary the UI turns into a toast.

**Tech Stack:** TypeScript (Express), React + MUI + RTK Query, Jest (existing use-case tests with in-memory fakes), q4j (Java 21) live API tests on the sandbox OLX stand.

**Spec:** `docs/superpowers/specs/2026-11-22-manual-price-to-olx-design.md`

## Global Constraints

- Same behaviour as the Hermes approval: product selling price + every listing price + one price-history row per listing + update job for each live OLX listing (`listing.isLive() && marketplaceListingId`, marketplace connected, account connected).
- Manual changes record `changedBy: 'user'`; Hermes keeps `changedBy: 'hermes'` and its reason.
- Same price as the current product price → no history row, no OLX job (`priceSync.unchanged = true`).
- Below `product.minAcceptablePrice` → refused with `InvalidStateError('The new price is below the lowest price you accept')` (existing text) for manual changes too.
- The Hermes approval's observable behaviour and existing tests do not change.
- UI copy (exact): dialog note `The price is also updated on OLX: the advert is rewritten from MarketDesk data.`; toasts `Price {price} saved and sent to OLX.`, `Price {price} saved. Not sent to OLX: {reason}.`, `Price {price} saved.` (no live OLX listing), where `{price}` is the formatted money and `{reason}` is `OLX is not connected` for `marketplace_not_connected`/`marketplace_account_not_connected`.
- Tests: q4j for live behaviour; Jest only in existing use-case/service test style (in-memory fakes, no new mocking). Real OLX is checked by hand on production.

## Review Focus

1. A product with a draft listing only — price changes in MarketDesk, no job, toast `Price … saved.` (Task 2 q4j `draftListingPriceChangeQueuesNothing`).
2. Edit product with unchanged price but other fields changed — no OLX job (Task 2 q4j `editWithoutPriceChangeQueuesNothing`).
3. Listing price dialog on a product with two listings — both listings and the product get the price (Task 1 Jest `appliesToEveryListing`).
4. Disconnected OLX account — saved, `skippedLiveListings` reported, toast with `OLX is not connected` (Task 1 Jest `reportsSkippedWhenAccountDisconnected`).
5. Price below minimum via Edit product — 422 and nothing saved (Task 2 q4j `editBelowMinimumIsRefused`).

---

### Task 1: PriceChangeService (approval keeps its behaviour)

**Files:**
- Create: `src/backend/application/services/MarketplaceUpdateEnqueuer.ts`, `src/backend/application/services/PriceChangeService.ts`
- Modify: `src/backend/application/usecases/ApproveHermesEventUseCase.ts` (use both; keep title/description paths on the enqueuer), `src/backend/config/di/container.ts`
- Test: `src/backend/application/__tests__/PriceChangeService.test.ts`; existing `ApproveHermesEventUseCase.test.ts` must stay green unchanged except constructor wiring

**Interfaces:**
- Produces:
  ```ts
  export interface MarketplaceUpdateOperation { operationId: string; listingId: string; marketplaceId: string }
  export interface PriceSync { unchanged: boolean; marketplaceUpdates: MarketplaceUpdateOperation[]; skippedLiveListings: Array<{ listingId: string; reason: string }> }
  // MarketplaceUpdateEnqueuer.enqueue(product: Product, changes: ListingUpdateJobChanges, options?: { requireAllLiveTargets?: boolean }): Promise<{ marketplaceUpdates; skippedLiveListings }>
  // MarketplaceUpdateEnqueuer.isLiveTarget(listing: Listing): boolean
  // PriceChangeService.apply(input: { workspaceId: string; productId: string; price: number; changedBy: 'user' | 'hermes'; reason?: string | null }): Promise<Result<PriceSync>>
  ```
- `apply` order: load product (workspace-scoped, NotFound) → Money in product currency → if equal to current selling price return `Ok({ unchanged: true, marketplaceUpdates: [], skippedLiveListings: [] })` → minAcceptablePrice check → `product.updateSellingPrice(money, changedBy === 'hermes')` (keep the existing flag semantics; read `updateSellingPrice` to confirm what the boolean means and pass the equivalent for manual) → save product → each listing: update price, save, record history (`reason ?? null`) → enqueue `{ price }`.

- [ ] **Step 1: Failing Jest** (style of `ApproveHermesEventUseCase.test.ts` fakes): `appliesToEveryListing` (product + 2 listings → all at new price, 2 history rows with `changedBy: 'user'`); `queuesOnlyLiveOlxListings` (live with remote id → 1 job; draft → none); `unchangedPriceDoesNothing`; `refusesBelowMinimum` (nothing saved); `reportsSkippedWhenAccountDisconnected`.
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement**; switch `ApproveHermesEventUseCase.applyPriceChange` to `PriceChangeService.apply({ …, changedBy: 'hermes', reason: event.detail ?? event.title })` and its `enqueueMarketplaceUpdates`/`isListingSeoLiveTarget` to the enqueuer. Approval of an unchanged price must still mark the event applied (outcome with no updates) — keep existing test expectations.
- [ ] **Step 4: Run** new + `ApproveHermesEventUseCase.test.ts` + related suites, `npm run type-check`, `npm run lint`.
- [ ] **Step 5: Commit** `refactor(pricing): share the price change path of Hermes approvals`.

### Task 2: Manual price edits use the service

**Files:**
- Modify: `src/backend/presentation/http/controllers/ListingController.ts` (`update`: when `price` is a number → `PriceChangeService.apply` for the listing's product with `changedBy: 'user'`, `reason` from body when a string), `src/backend/application/usecases/UpdateProductUseCase.ts` or `ProductApplicationService.updateProduct` (when `sellingPrice` is provided and differs → apply the price through the service; other fields as today), DI, response DTOs
- Test (q4j): `test-automation/.../test/api/ManualPriceSyncTest.java` (+ steps/service/verification following `ListingReactivationTest`/`PriceResearchTest`)

**Interfaces:**
- Consumes: `PriceChangeService.apply`, `PriceSync` (Task 1).
- Produces: `PATCH /listings/:id` response = listing view + `priceSync: PriceSync`; `PATCH /products/:id` response = product view + `priceSync?: PriceSync` (present only when a price was sent). Both errors unchanged in shape (422 for below minimum).
- Listing PATCH no longer records its own history row (the service does).

- [ ] **Step 1: Failing q4j** on the sandbox OLX stand: `livePriceChangeQueuesOlxUpdate` (publish a sandbox listing so it is live, PATCH price → `priceSync.marketplaceUpdates` has 1 entry, product price equals new price); `editPriceMovesListingAndQueues` (PATCH product `sellingPrice` → listing price follows, 1 update); `samePriceQueuesNothing` (`unchanged: true`); `editWithoutPriceChangeQueuesNothing`; `draftListingPriceChangeQueuesNothing`; `editBelowMinimumIsRefused` (422, prices unchanged). Use existing steps to publish on the sandbox (see `ListingReactivationTest`/`RevivalTest`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new q4j + `PriceResearchTest`, `RevivalTest`, `ListingReactivationTest`; Jest suites for controllers/use cases touched; type-check; lint.
- [ ] **Step 5: Commit** `feat(pricing): send manual price changes to OLX`.

### Task 3: Interface copy

**Files:**
- Modify: the listing price dialog component (find it from `ListingDetailsPage.tsx` `handleUpdatePrice` / `setPriceListing`), `ListingDetailsPage.tsx` (`handleUpdatePrice`, `handleEdit` toasts), `src/frontend/state/api/listingsApi.ts` / `productsApi.ts` response types (`priceSync`), shared types if the views are shared
- Create: `src/frontend/components/product-detail/priceSyncMessage.ts` (+ test)

**Interfaces:**
- Produces: `priceSyncMessage(sync: PriceSync | undefined, priceText: string): string` returning the exact toast copy from Global Constraints (`unchanged` → `Price {price} saved.`).

- [ ] **Step 1: Failing Jest** `priceSyncMessage.test.ts`: sent (1 update) → `Price 318,00 zł saved and sent to OLX.`; skipped account → `Price 318,00 zł saved. Not sent to OLX: OLX is not connected.`; no live listing / unchanged / undefined → `Price 318,00 zł saved.` (use the project's `formatCurrency` for the price text in the caller; the helper takes the text).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; dialog shows the note line; both handlers toast `priceSyncMessage(...)`.
- [ ] **Step 4: Run** Jest, type-check, lint, build.
- [ ] **Step 5: Commit** `feat(ui): say whether a price change reached OLX`.

### After merge (owner-approved)

- [ ] Deploy; on AirPods 4 set 318 in MarketDesk; confirm toast "sent to OLX" and 318 on olx.pl.
