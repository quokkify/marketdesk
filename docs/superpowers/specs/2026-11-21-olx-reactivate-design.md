# Reactivate an expired OLX advert — design

## Intent

The owner's imported adverts are `outdated` on OLX. MarketDesk's relist publishes a NEW advert
(`POST /adverts`), leaving the old one expired on OLX: a duplicate, a spent free slot, lost views.
OLX documents `POST /adverts/{id}/commands` with `command: activate` to bring an outdated or
user-removed advert back with the same id. MarketDesk should use it.

## Goals

- `POST /api/listings/:id/reactivate` (no body): for an `expired` listing that has an OLX advert id,
  call OLX `activate`, re-read the advert, and answer `{ listing, outcome, remoteStatus }`.
  - `active` → listing becomes `live` (`outcome: 'live'`).
  - `new` (moderation) → listing unchanged, `outcome: 'pending_moderation'`; the next sync flips it.
  - `limited` → listing unchanged, `outcome: 'limited'`: OLX's free limit for the category is used
    up and it wants a paid packet. MarketDesk buys nothing.
  - anything else → listing unchanged, `outcome: 'unchanged'` with the status.
- Refusals: sandbox OLX → 422 `Reactivation is not available in sandbox mode`; listing of another
  workspace or unknown → 404; listing not `expired` or without an OLX advert id → 422.
- Activity log entry `olx.advert_reactivated` with outcome and remote status.
- Product page: for an expired listing with an OLX advert id (not sandbox) the primary action is
  "Reactivate on OLX" with a confirmation dialog; the result is shown as a toast.

## Non-goals

- Editing title, price or photos before reactivation (future LangGraph "revival" flow).
- Buying packets; quota guard (activate never charges: an exhausted limit yields `limited`).
- Changing relist; it stays for listings without an OLX advert id.

## Approaches

1. **Dedicated endpoint + application service calling a new adapter method (chosen).** Small,
   synchronous (one command + one read), explicit outcome for the UI.
2. Route through the publish job queue as `mode: 'reactivate'`. Rejected: the publish pipeline is
   built around non-idempotent creation, quota reservation and checkpoints that activate does not need.
3. Leave it to the seller on olx.pl + Sync. Rejected: the point is to sell from MarketDesk.

## Testing

Live q4j API tests against the branch stack: 401 unauthenticated, 404 unknown listing, 422 in
sandbox for a listing created through the API. The real OLX path is verified on production with one
of the owner's imported products.
