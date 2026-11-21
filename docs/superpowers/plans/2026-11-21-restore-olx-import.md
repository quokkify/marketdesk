# Restore OLX Advert Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make importing existing OLX adverts reachable again: two endpoints and an "Import from OLX" action with a full preview on the Marketplaces page.

**Architecture:** `MarketplaceImportService` (preview + import) is intact on `main` and built in `src/backend/config/di/container.ts`. Restore the HTTP surface removed in PR #448 (commit `8c3feea0b9`) and the UI removed in PR #447 (commit `2112b0aad9`), adapted to current code. The pre-removal code is the reference: `git show 8c3feea0b9~1:<path>` and `git show 2112b0aad9~1:<path>`.

**Tech Stack:** Express + zod (`validateBody`), RTK Query, React + MUI, Jest (backend supertest; frontend has no DOM: pure functions plus `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-11-21-restore-olx-import-design.md`

## Global Constraints

- Endpoints: `POST /api/marketplaces/:id/import-preview` (200) and `POST /api/marketplaces/:id/import` (201).
- In OLX sandbox mode both return 422 `Marketplace import is not available in sandbox mode` without calling the service.
- No write to OLX during preview or import; `MarketplaceImportService` behaviour is unchanged.
- Workspace scoping comes from `req.user.workspaceId`, never from the body.
- The preview UI lists every advert, not the first five.
- Button label: `Import from OLX`. Shown only when the marketplace is connected and not sandbox.
- Repo is public: no secrets, internal URLs or machine paths in code, tests or commits.

## Review Focus

1. A body with `pageSize: 0`, negative, non-integer or above 100 — expect 400 from validation; the OLX adapter loops pages with `limit: pageSize`, so a bad value must never reach it.
2. `externalListingIds` that is not an array of non-empty strings, or longer than 500 entries — expect 400.
3. `statuses` entries that are not short status tokens (e.g. `'active,removed'`, `'../x'`, empty string) — expect 400; each entry must match `^[a-z_]{1,32}$`, at most 10 entries. The adapter joins them with commas into the OLX query, so a comma inside an entry must be rejected.
4. Import pressed when preview has zero new + changed — the import button is disabled.
5. Import succeeds — products and listings lists refresh without a page reload (cache tags invalidated).

---

### Task 1: Backend import endpoints

**Files:**
- Modify: `src/backend/presentation/http/validation/schemas.ts` (add two schemas)
- Modify: `src/backend/presentation/http/controllers/MarketplaceController.ts`
- Modify: `src/backend/presentation/http/routes/marketplaces.ts`
- Modify: `src/backend/presentation/http/app.ts` (`AppDeps.marketplaceImportService`, pass to controller)
- Modify: `src/backend/config/di/container.ts` (expose `marketplaceImportService` in the container/app deps as before #448)
- Test: `src/backend/presentation/__tests__/api.integration.test.ts`

**Interfaces:**
- Produces: `importMarketplacePreviewSchema` = strict object `{ pageSize?: int 1..100, statuses?: string matching `^[a-z_]{1,32}$`, array max 10 }`; `importMarketplaceAdvertsSchema` = the same plus `externalListingIds?: string(min 1, max 64)[] max 500`.
- Produces: `MarketplaceController.importPreview` and `.importApply` with the bodies shown in `git show 8c3feea0b9 -- src/backend/presentation/http/controllers/MarketplaceController.ts`, including `sandboxImportUnavailable()`; read values from the validated body.
- Response shapes are the service's `ImportPreviewResult` and `ImportApplyResult`, unchanged.

- [ ] **Step 1: Restore the removed API tests** from `git show 8c3feea0b9 -- src/backend/presentation/__tests__/api.integration.test.ts` (the "previews existing OLX adverts…", "imports selected OLX adverts only after an explicit import request" and the sandbox `it.each` returning 422 without reaching the service), adapted to the current test harness. Add:
  - `it.each([0, -1, 1.5, 101])('rejects pageSize %p with 400 before the import service')`, asserting the service mock was not called.
  - `it('rejects externalListingIds that is not a string array with 400')` with `{ externalListingIds: 'olx-1' }` and `{ externalListingIds: [1] }`.
  - `it('rejects malformed statuses with 400')` with `{ statuses: ['active,removed'] }` and `{ statuses: [''] }`.
  - `it('scopes import to the caller workspace')`: the service mock receives `workspaceId` of the authenticated user even when the body carries `workspaceId: 'other'` (strict schema → 400 is also acceptable; assert whichever the strict schema yields and that the service is not called with `'other'`).
- [ ] **Step 2: Run** `npx jest src/backend/presentation/__tests__/api.integration.test.ts -t "import"` — expect FAIL (404 on the routes).
- [ ] **Step 3: Implement** schemas, controller methods, routes (`router.post('/:id/import-preview', validateBody(importMarketplacePreviewSchema), asyncHandler(controller.importPreview))`, same for `/:id/import`), and deps wiring in `app.ts` and `container.ts`. Apply a rate limiter only if neighbouring marketplace routes use one.
- [ ] **Step 4: Run** the same jest command — PASS; then `npm run type-check && npm run lint` — no errors.
- [ ] **Step 5: Commit** `feat(olx): bring back the import endpoints for existing adverts`.

### Task 2: Import action and preview panel in the UI

**Files:**
- Modify: `src/frontend/state/api/dto.ts` (restore `MarketplaceImportPreviewInput`, `MarketplaceImportApplyInput`, `MarketplaceImportPreviewItemStatus`, `MarketplaceImportPreviewItem`, `MarketplaceImportPreview`, `MarketplaceImportApplyResult` from `git show 2112b0aad9~1:src/frontend/state/api/dto.ts`; re-export where the other DTOs are re-exported)
- Modify: `src/frontend/state/api/marketplacesApi.ts` (restore `importMarketplacePreview` and `importMarketplaceAdverts` mutations and the `useImportMarketplacePreview` / `useImportMarketplaceAdverts` exports; import invalidates `Marketplace` id + LIST, `Product` LIST, `Listing` LIST)
- Create: `src/frontend/components/marketplaces/MarketplaceImportPanel.tsx` (+ `.test.tsx`)
- Modify: `src/frontend/components/marketplaces/MarketplaceCard.tsx` (+ test): new prop `onImport: (marketplace: Marketplace) => void`, an outlined `Import from OLX` button when `connected && !m.sandbox`, next to Sync
- Modify: `src/frontend/pages/MarketplacesPage.tsx` (+ test): wire preview → panel → import, following the removed handlers in `git show 2112b0aad9 -- src/frontend/pages/MarketplacesPage.tsx`

**Interfaces:**
- Consumes: Task 1 endpoints and response shapes.
- Produces: `MarketplaceImportPanel` props `{ preview: MarketplaceImportPreview; busy: boolean; onImport: () => void; onClose: () => void }`. It shows the six totals chips (Discovered, New, Changed, Already imported, Unsupported, Failed), **every** item (title, status, warnings), an `Import new and changed` button disabled when `busy || totals.new + totals.changed === 0`, and a `Close` button.
- The page imports `externalListingIds` = ids of items with status `new` or `changed`, then shows a success/failure message with the apply result counts and closes the panel.

- [ ] **Step 1: Write failing tests** (renderToStaticMarkup):
  - `MarketplaceImportPanel.test.tsx`: `renders every advert, not only the first five` (preview with 7 items → all 7 titles present, no "Showing first" text); `disables import when nothing is new or changed` (totals new 0, changed 0 → button markup has `disabled`); `shows all six totals`.
  - `MarketplaceCard.test.tsx`: `shows Import from OLX for a connected real marketplace`; `hides Import from OLX in sandbox`; `hides Import from OLX when not connected`.
  - `MarketplacesPage.test.tsx`: update the RTK mocks to include the two import hooks so the existing page tests keep rendering.
- [ ] **Step 2: Run** `npx jest src/frontend/components/marketplaces src/frontend/pages/MarketplacesPage.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** DTOs, mutations, panel, card prop/button, page wiring.
- [ ] **Step 4: Run** the same jest command — PASS; then `npm run type-check && npm run lint && npm run build` — no errors. Type-check the changed tests with a temp tsconfig (the main tsconfig excludes `*.test.*`).
- [ ] **Step 5: Commit** `feat(olx): add Import from OLX with a full preview to the Marketplaces page`.

### Task 3: Docs touch-up

- [ ] **Step 1:** Where #448 edited docs to say import has no endpoint (`docs/olx-import-foundation.md`, `docs/spec/PRODUCT.md`, `docs/spec/TRACEABILITY.md` — see `git show 8c3feea0b9 -- docs`), restore the statements that import is reachable via the two endpoints and the Marketplaces page.
- [ ] **Step 2:** Run `npm test` (full suite, `SKIP_REDIS_TESTS=true` if local Redis is not this project's) — green.
- [ ] **Step 3: Commit** `docs: describe the restored OLX import`.
