# Revive an expired OLX advert — design

## Intent

The owner sells through OLX and wants selling to get easier, heading toward "AI sells on autopilot".
Expired adverts can already be reactivated, but they come back with the old text and price, and
imported products carry unknown facts (condition `unknown`, no cost price). The owner wants one
screen per expired advert: what is missing, what Hermes proposes (title, description, price), tick
what to keep, and one button that applies it and brings the advert back on OLX. Nothing reaches OLX
before that click. First real cases: the imported AirPods 4 and Frezarka adverts (both `outdated`).

## Current state

- `ProductAssistanceGraph` (LangGraph) has kinds `draft`, `publication`, `improve`. `improve` calls
  Hermes for listing SEO (`listingSeoOutputSchema`: up to 10 `{field: title|description,
  proposedValue, rationale}` plus a disclaimer) and for a price (`priceSuggestionSchema`), returns a
  review-only result with `aiUsage` (PR #479). Nothing is applied.
- `ListingReactivationService` (`POST /api/listings/:id/reactivate`, PR #478/#480/#481) sends OLX
  `activate`, reads the advert back, sets the listing live on `active`, reports `pending_moderation`
  for `new`/`disabled`, `limited` when a paid packet is needed, puts a draft product on sale.
- `OLXAdapter.updateListing(id, changes{price, description, productName}, current)` sends
  `PUT /adverts/{id}` with the FULL advert payload built from MarketDesk data: title, description,
  category, price, images, location and contact from env config, attributes including condition.
- Products are edited with `PATCH /api/products/:id`; condition values: `new | like_new | good | fair
  | poor | refurbished | unknown`. The OLX adapter maps `unknown` to `used` silently.
- The product page shows "Reactivate on OLX" as the primary action for an expired listing with an
  OLX advert id.

## Goals

1. **Revival proposal** — `POST /api/listings/:id/revival-proposal` runs a new `revive` kind of
   `ProductAssistanceGraph` for an expired OLX listing:
   - `missingFacts` (rules): condition `unknown` → required; no cost price → optional, with the note
     that a price floor cannot be checked without it.
   - `improve` (existing Hermes calls): title/description recommendations and a price suggestion.
   - `priceGuard` (rules): a proposed price below a known cost price is flagged and unticked by
     default; with no cost price the guard says it could not check.
   - Returns `{ listingId, productId, productUpdatedAt, listingUpdatedAt, missingFacts, title?,
     description?, price?, priceGuard, aiUsage }`, review-only. Offline AI still returns missing
     facts and the guard, with no copy/price proposals and `aiUsage` provider `offline`.
2. **Revival screen** on the product page: the primary action for an expired listing with an OLX
   advert id becomes **"Revive on OLX"**, opening a dialog (layout approved by the owner):
   ```
   Revive «Apple AirPods 4»
   Needed:        Condition [select ▾] (now unknown)    Cost price [____] (optional)
   Hermes:        [x] Title: «…»   [x] Description: (old → new)   [ ] Price: 349 → 319 zł (why…)
                  tokens 2 100 · included in subscription
                  [ Apply and bring back on OLX ]
   ```
   The button stays disabled until condition is not `unknown`. Plain "Reactivate on OLX" (no
   changes) remains available as a secondary action.
3. **Apply** — `POST /api/listings/:id/revive` with `{ condition, costPrice?, title?, description?,
   price?, productUpdatedAt, listingUpdatedAt }` (only ticked fields are sent):
   1. Refuses when the product or listing changed since the proposal (stale timestamps → 409), when
      the listing is not expired / has no OLX advert, in sandbox (422), and when `price` is below a
      known cost price unless `allowBelowCost: true` (existing below-cost rule).
   2. Saves the product (condition, cost price, title/description) and the listing price.
   3. Updates the advert on OLX (`PUT`, existing adapter call) with the new data.
   4. Reactivates through `ListingReactivationService` and returns its outcome.
   Each step is recorded in the activity log (`olx.advert_revived` with what changed and the
   outcome). If OLX refuses the update, nothing is reactivated and the saved product changes stay
   (the owner can retry or reactivate plainly); the error names the step and carries OLX's reason.
   If the update succeeds but reactivation fails, the response says the advert was updated but is
   still expired.
4. **No more silent `unknown` → `used`** — publishing and relisting refuse a product whose condition
   is `unknown` with a clear validation error ("Choose the product's condition before publishing to
   OLX"); the publish review on the product page shows it.

## Non-goals

- Pausing a graph for approval with a checkpointer (deferred until autopilot work).
- Changing photos, category, location or contact from the revival screen.
- Automatic revival or scheduled re-checks of expired adverts.
- Market-based pricing (comparables).

## Anti-goals

- Anything reaching OLX before the owner's click.
- Guessing a cost price or a condition: both are facts only the owner supplies.
- Buying OLX packets or any paid action.
- A failure in a later step silently undoing or hiding an earlier one.

## Approaches

1. **`revive` branch in `ProductAssistanceGraph` + one apply action (chosen by the owner).** Reuses
   the Hermes calls, the OLX update and the reactivation service; each step is visible in logs and the
   activity log.
2. No new graph; the screen composes existing actions. Rejected: the missing-facts and price-guard
   logic would live in the UI, against "sales scenarios live in graphs".
3. LangGraph with an approval interrupt and persisted graph state. Deferred: a second store of
   seller data and much more work; option 1 leaves the path open.

## Risks to verify on production first (one product)

- `PUT /adverts/{id}` rewrites the whole advert. For imported products the images are OLX image URLs
  and location/contact come from MarketDesk env (`OLX_CITY_ID`, `OLX_DISTRICT_ID`,
  `OLX_CONTACT_NAME`, `OLX_CONTACT_PHONE`). Verify OLX accepts its own image URLs and that location
  and contact stay right, on one advert, before relying on it.
- Whether OLX accepts `PUT` on an `outdated` advert is undocumented. If it refuses, the apply order
  becomes activate → update; the implementation must make the order a single switch and report the
  OLX refusal clearly. The first production run decides.
- OLX re-moderates after changes, so the expected outcome is often `pending_moderation`.

## Testing

Owner rule: live q4j tests in `test-automation`, no new Jest tests with mocks (pure-function Jest
tests are fine). On the branch Compose stack (OLX stub, offline AI):
- API: revival proposal for an expired listing returns missing facts (condition required) and a price
  guard; apply in sandbox → 422 after validation; apply with `condition: unknown` → 400; stale
  `productUpdatedAt` → 409; 401; another workspace's listing → 404; publishing a product with
  condition `unknown` → validation error. Getting an expired listing on the stub stack needs a setup
  path (e.g. the sandbox sync/expiry the stub supports, or a test-only seed) — builder's call, stated
  in the plan.
- UI: the product page shows "Revive on OLX" for that listing; the dialog shows the condition field
  and keeps the button disabled until a condition is chosen.
- Pure Jest: missing-facts and price-guard rules.
- The real OLX path (update + activate) is verified on production with one product, watching logs.

## Settled after the builder check (agent's calls unless marked)

- **Apply order**: default update → activate, as a single code constant. If production shows OLX
  refuses `PUT` on an outdated advert, the constant flips to activate → update. In that order a failed
  update leaves the advert live with its old text; the response says so plainly ("back on OLX with the
  old text; the update was refused: <reason>"). Accepted: a plain reactivation is already acceptable
  to the owner. In the default order a failed update reactivates nothing.
- **Retries**: every apply response (success or step failure) returns the fresh `productUpdatedAt`
  and `listingUpdatedAt`; the dialog keeps them, so a retry from the same dialog is not stale. A retry
  re-sends the ticked fields; saving the same values again is harmless.
- **Below cost**: when the price guard flags a price below the known cost price, the price row shows
  a "Sell below cost" confirmation checkbox (the existing below-cost confirmation pattern); ticking it
  sends `allowBelowCost: true`. Without it the price is not applied.
- **Condition and cost fields**: the condition select is always shown, pre-filled with the current
  value (required only when it is `unknown`); cost price can be set or changed, never cleared from
  this screen.
- **`unknown` block scope**: new publish and relist (and revive apply) refuse `unknown`. Updates of
  already-live adverts (`updateListing`, including Hermes-approved price/title changes) are not
  blocked, so live imported adverts such as the projector keep working; no data backfill.
- **One title, one description**: from the `improve` recommendations, the first `title` and the first
  `description` recommendation are used (the agent returns at most one per field in practice); the
  rationale is shown under each.
- **Live test reach**: on the stub stack the revive apply stops at the sandbox guard (422), so the
  update/activate error paths are verified on production with one product, watching logs; the plan
  covers everything before the guard live (validation 400, stale 409, 401, 404) plus the proposal.

## Left to the builder

Dialog layout details within the page style, exact wording of messages (English UI, as elsewhere),
whether the proposal call is cached for the dialog session, and how the q4j stack gets an expired
listing.
