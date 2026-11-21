# Reactivate Expired OLX Advert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One click brings an expired OLX advert back with the same id instead of creating a duplicate.

**Spec:** `docs/superpowers/specs/2026-11-21-olx-reactivate-design.md`

## Global Constraints

- Tests are live q4j tests in `test-automation` (owner rule); no new Jest mock tests.
- Sandbox message verbatim: `Reactivation is not available in sandbox mode`.
- Activity action verbatim: `olx.advert_reactivated`.
- UI label verbatim: `Reactivate on OLX`.

## Review Focus

1. OLX answers `activate` with 4xx (advert deleted, not activatable) → the request fails with the provider's reason, listing unchanged.
2. `activate` succeeds but the re-read fails → listing unchanged, error surfaced; the next sync reconciles.
3. A double click sends two reactivations → the second sees a live listing and is refused with 422.
4. A listing whose advert id belongs to an account that was reconnected → token of the current account is used; OLX 404 → listing unchanged.
5. Product page shows the action only for expired + advert id + non-sandbox.

### Task 1: q4j tests (RED), endpoint, service, adapter method
- [ ] q4j `ListingReactivationTest`: 401, 404 (random UUID), 422 sandbox for a draft listing created via `POST /api/products` + `POST /api/products/:id/listings`.
- [ ] `IMarketplaceAdapter.reactivate?(externalListingId): Promise<SyncedListing | null>`; base wrapper `execute('reactivate', …, { retry: false })`; OLX: `POST {base}/adverts/{id}/commands {command:'activate'}` then `doFetchListing`.
- [ ] `ListingReactivationService.reactivate({ listingId, workspaceId, actorId })` with an adapter resolver for the marketplace (container: same token path as category correction).
- [ ] `ListingController.reactivate`, route `POST /:id/reactivate` with `sensitiveLimiter` and an empty strict body schema.
- [ ] Commit `feat(olx): reactivate an expired OLX advert instead of publishing a duplicate`.

### Task 2: Product page action
- [ ] RTK mutation `reactivateListing`, hook, primary action `reactivate`, confirm dialog, toast per outcome; invalidate Listing/Product tags.
- [ ] q4j UI guard is not possible on the stub stack (no expired real listing); verify on production.
- [ ] Commit `feat(olx): add Reactivate on OLX to the product page`.
