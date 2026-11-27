# Advert completeness checks: category, attributes, delivery

Date: 2026-11-27. Status: draft for owner approval.

## Why

A week after going live, the three production adverts (AirPods 4, nail drill, projector) have 9-17 lifetime views, no
phone views and no threads (OLX Partner API statistics, read 2026-11-27). The "Why no response?" graph put all three
at `not_seen`, at positions 44-254 in buyer searches. OLX's terms list the inputs to its default search order. Among
them are attribute completeness, a category that matches the search, and Przesyłka OLX availability. The adverts fail
all three:

- every advert carries only the `state` attribute, while the categories offer more: 1973 headphones offer `brand`,
  `type`, `etui`, `bdo`, `delivery`, and 1984 projectors offer `brand`, `light`, `type`, `type_matrix`, `resolution`,
  `bdo`, `delivery`;
- the nail drill sits in 5091 (Firma i Przemysł → Wyposażenie salonów), a business category whose only attribute is
  `state`. It has no `delivery` attribute, so the advert cannot get Przesyłka OLX at all;
- the AirPods advert has four `ad_delivery.delivery_package_ids`, but its public page reports
  `delivery.rock.mode: NotEligible`. The cause is unknown. The projector shows `BuyWithDelivery`.

The research report behind this design ranks "fill every category attribute and confirm the category" and "enable
Przesyłka OLX" second and third among the actions for a seller with almost no views.

Since 2026-11-13 the owner's goal has been selling on autopilot. The owner chose the autonomy level for this work
(option Б): MarketDesk applies on its own what it can verify, and asks the owner about what it cannot.

## Goals

1. An advert update from MarketDesk never removes attributes that are already on OLX.
2. The sale verdict tells the owner whether each live OLX advert is in the right category, has its attributes filled,
   and shows delivery to buyers.
3. MarketDesk fills an empty attribute on its own when the value is verifiable. "Verifiable" means the value is one of
   OLX's allowed values for that attribute and its label appears in the product's own title or description.
4. What MarketDesk cannot verify becomes a proposal the owner approves with one click: an attribute value Hermes chose,
   a category move, or a delivery package size.

## Non-goals

- Changing the "Why no response?" graph. It answers "where am I in search", and these checks answer "is the advert
  complete".
- Scheduled runs. The checks run when the verdict runs. Running them after every sync can come later.
- Paid features (refresh, highlight) and the free refresh on day 14.
- Fixing why OLX marks the AirPods advert `NotEligible`. The check reports it; the cause stays an open question.

## Anti-goals (failure even if it works)

- MarketDesk overwrites a value the seller set by hand, on OLX or in MarketDesk.
- MarketDesk moves an advert to another category, or turns on a paid package, without the owner's approval. A category
  move recreates the advert and can consume a paid publication slot.
- Seller or Hermes free text ends up in graph state or logs. The existing verdict rule still holds: state holds only
  app-authored check items and event ids.

## Approaches

1. **New checks inside the sale verdict graph (chosen).** Add `category`, `attributes` and `delivery` checks next to
   `info`, `price` and `photos`, each a self-contained check subgraph. Attribute filling is deterministic first, with
   Hermes as the fallback. Pros: one screen, one run history, and the existing verdict runs, scopes and proposals are
   reused. Cons: the verdict graph grows from three checks to six.
2. **A separate "advert completeness" graph run after each sync.** It is independent and would catch lost attributes on
   its own. Cons: a second screen, run table and set of limits. Goal 1 already stops attribute loss, so the only gain
   is the schedule, and a schedule can be added to approach 1 later.
3. **Deterministic matching only, no Hermes.** Cheap and predictable, but OLX value labels often differ from how the
   seller wrote the model, so some attributes would stay empty.

The owner chose approach 1 on 2026-11-27. Approach 3 lives on inside it as the first step of attribute filling.

## Design

### Part 1: updates keep remote attributes (separate, first PR)

`OLXAdapter.doUpdateListing` already reads the advert (`fetchDeliveryPackageIds`) before its full-replace `PUT`. Widen
that read to return the remote `attributes` too, and send the merge:

- start from the remote attributes;
- override only the attributes MarketDesk owns (today: the condition attribute) and the ones this update sets
  explicitly (part 2);
- keep the existing `ad_delivery` behaviour.

The create path (`POST`) is unchanged. Tests: a q4j live API test on the branch stand. Its OLX mock returns an advert
with extra attributes, and the test asserts that the `PUT` body still contains them. This is a regression guard for
the wipe.

### Part 2: three new verdict checks

`VerdictCheckName` becomes `'info' | 'price' | 'photos' | 'category' | 'attributes' | 'delivery'`. All three new checks
need a live OLX listing. `VerdictCheckStatus` has no "not applicable" value, and none is added: without a live OLX
listing the three checks are left out of the run's scope, and the verdict combines without them.

**Order.** `attributes` and `delivery` depend on the category. When the `category` check finds a mismatch in the same
run, the other two return `needs_human` with the reason "fix the category first", and they make no proposals and no
writes. Otherwise the three run in parallel like the existing checks.

**`category` check (code only).**

- Call `GET /categories/suggestion?q=<listing title>`.
- If the listing's category id is among any of the suggestions, the check is `ready`. No score threshold: a mismatch
  only ever produces a proposal, and the owner approves every move.
- If not, the check is `fix`, and MarketDesk raises the existing `olx_category_mismatch` event with a
  `category_recreation` change targeting the top suggested leaf. The owner then goes through the existing audited
  delist plus quota-guarded recreate flow (`docs/olx-category-safety.md`). Nothing new is built for applying it.
- Raise at most one open event per listing and suggested category, matching the idempotency of the existing producers.

**`attributes` check.**

1. Load `GET /categories/{id}/attributes` and the advert's current attributes from `GET /adverts/{id}`.
2. Empty attributes are those offered by the category, not set on the advert, and not `delivery` (handled by its own
   check). Only attributes with an enumerated value list and a single value (`allow_multiple_values: false`) are
   candidates for filling. Numeric, free-text and multi-value attributes are never filled, so no free text is ever
   written or proposed. They are listed as "still empty" in the check reasons.
3. **Code match.** For an empty attribute with an enumerated value list: if exactly one allowed value label occurs as
   a whole word (case- and diacritic-insensitive) in the product name or description, that value is verifiable.
4. **Auto-apply.** All verifiable values go out in one update (part 1's merged `PUT`), recorded as a Hermes event with
   `autonomyDecision: 'auto_apply'` and status `applied`. That way the owner sees what changed and can revert it by
   hand. Values already set are never touched.
   - The write happens inline in the check, as a single `PUT` per run. It goes through the same apply code an approved
     `attributes` proposal uses.
   - The event's idempotency key covers the listing and the attribute values, so a retried run does not write again.
   - Only this check writes during a run: `delivery` and `category` only propose. Two full-replace `PUT`s therefore
     never race.
   - After the write, the check re-reads the advert. A value OLX dropped or rejected is reported as a reason and does
     not count as filled.
5. **Hermes fallback.** Empty attributes without a verifiable value go to Hermes on the `marketdesk` no-tools profile.
   Hermes gets the allowed values and the product text and must answer with a value code from the list, or with
   nothing. Any answer outside the list is dropped. Its picks become one proposal (`pending_review`) with a new
   `proposedChange.kind: 'attributes'`; approving it sends the merged update.
6. Result, in this order:
   - `fix` while an `attributes` proposal is open;
   - `needs_human` when a **required** attribute (`validation.required`) is still empty;
   - otherwise `ready`, with any still-empty optional attributes listed as reasons.

   Optional attributes that neither code nor Hermes can fill (`bdo`, often `etui`) must not keep every advert out of
   `ready`.

**`delivery` check.**

- Read what the buyer sees: the public advert page's `__PRERENDERED_STATE__` → `ad.delivery.rock.mode`, loaded through
  the existing process-wide OLX page gate (`createOlxRequestGate`) and its timeouts.
- `BuyWithDelivery` → `ready`.
- `NotEligible` with no `ad_delivery` packages, in a category that offers `delivery`, → `fix`, plus a proposal (new
  `proposedChange.kind: 'delivery'`).
  - The category's `delivery` attribute values are the package ids `ad_delivery.delivery_package_ids` takes. Checked on
    prod on 2026-11-27: projector category 1984 lists 14 packages, labelled carrier plus size, for example
    "InPost Paczkomat® 24/7 S" or "DPD Kurier M", and the projector's own package ids are among them.
  - The proposal carries a parcel **size** (S/M/L/XL). Hermes picks it from the product text and the size list, and the
    owner confirms it.
  - Applying the proposal sends the merged update with every package of that size in `ad_delivery.delivery_package_ids`
    (the AirPods advert holds all four S packages).
  - Packages are written only through `ad_delivery`, never as an `attributes` entry.
- `NotEligible` while packages are set (the AirPods case) → `needs_human`, with the reason "OLX does not offer delivery
  on this advert although packages are set; check it in OLX". No proposal.
- The category offers no `delivery` → `fix`, with the reason pointing at the category check.
- If the page cannot be read → `needs_human` with `probe_failed`, the same convention as the response graph.

### UI

The Hermes card already lists verdict checks with their reasons and proposals. The three new checks show there in the
same way, with no new screen. An auto-applied attribute event reads like "Filled brand: Apple (found in the title)".

## Constraints

- OLX `PUT /adverts/{id}` is a full replace. Every write in this design goes through part 1's merge.
- OLX token handling: only the app refreshes tokens. Probes and tests never refresh them from outside.
- Migrations replay on every start. Anything added must be idempotent (`IF NOT EXISTS`, no `DROP`).
- Tests are live q4j API/UI tests in `test-automation/` on a branch stand with the OLX mock, not Jest mocks. Real-OLX
  paths are checked by hand after deploy.
- AI calls are attributed to the `verdict` feature, as the existing checks are.

## Decided with the owner

- Autonomy option Б: auto-apply verifiable attribute values; ask for category, delivery size and Hermes-chosen values.
- Approach 1: checks inside the sale verdict graph.
- Order: part 1 (keep remote attributes) as its own PR first, then part 2.

## My calls (owner may override)

- A category move reuses the existing `category_recreation` flow instead of an in-place category change.
- The delivery state is read from the public page, because the API field disagreed with what buyers see.
- "Verifiable" means one allowed value as a whole word in the product's own text. Anything weaker goes to Hermes and the
  owner.
- Only single-value enumerated attributes are filled. `needs_human` is reserved for an empty required attribute, and
  empty optional ones are listed, not blocking.
- The auto-apply write is inline, one `PUT` per run, idempotent, and followed by a re-read.
- A delivery proposal is a parcel size, applied as all packages of that size.
- A category mismatch means the listing's category is in none of the suggestions; there is no score threshold.

## Left to the builder

- Where the category suggestion and attribute list calls live (adapter methods vs. a small OLX catalogue port), and
  whether to cache category attributes per run.
- Exact event types and titles for the new proposals, within the existing `HermesEventType` conventions.
- The whole-word matching details for labels with digits or punctuation (`720p`, `USB-C`).
