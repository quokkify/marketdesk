# Price anchor ladder for items no longer sold new

Status: approved approach (A of A+C), design for planning.
Part C (market price discovery: timed drops driven by views, watchers and conversations) is a
separate design that follows this one.

## Intent

The agent must propose a sensible start price on its own, including for an item that is no longer
sold new and has no exact used comparables. This serves the autopilot goal: no manual step per
product.

Trigger case: `Projektor AOPEN QH11 LED HD 720p HDMI – Stan Bardzo Dobry`, listed at 299 zł,
9 views and 0 watchers after a day. The seller found no price proposal. A manual web search found
that the model is discontinued (Komputronik: 799 zł, marked archived; Acer PL store: out of stock),
specs are easy to find (720p, 200 lm, LED), and nothing in the current flow reaches either fact.

### Why the current flow fails (on `main` at a14853339b)

- `comparableSearchPrompt.ts` searches OLX.pl only, for the same model and variant in used
  condition. A rare or discontinued model returns `[]`.
- Search results are not stored. The seller ticks candidates and saves them into
  `product_price_research`; the estimate sees only what was saved.
- `priceEstimatePrompt.ts` runs on the no-tools profile. Without a saved retail price the model
  "estimates the retail anchor itself" from memory. For a discontinued budget item that anchor is
  stale or invented, and `startPrice <= retailAnchor` is the only ceiling.
- `HermesDecisionEngine.priceEstimateSuggestion` returns `null` (nothing visible) when the
  confidence is `low` or the estimate is within 5 % of the current price
  (`shouldSurfacePriceEstimate`). So a weak estimate is silent, and the seller cannot tell "agent
  thinks 299 is fine" from "agent knows nothing".

### Core pricing idea

For cheap electronics, the price of a used item is capped by what the buyer would buy instead
today: the cheapest new item of the same class. The last new price of the model itself is history,
useful only as an upper bound and a sanity check.

## Goals

1. A research step that walks a ladder of price anchors and labels each found price with its tier:
   - `same_model_used`: the same model, used, on OLX.pl, Allegro, Allegro Lokalnie.
   - `last_new_price`: the last known new price of the model (archived shop pages, Ceneo,
     manufacturer store), with the date it was seen.
   - `substitute_new`: new items of the same class sold today, matched by key specs.
   - `substitute_used`: used items of the same class on OLX.pl / Allegro Lokalnie.
   Before the substitute tiers the agent determines the key specs of the item (for QH11: native
   720p, 200 lm, LED) and reports them with the result.
2. Found prices are saved into the product's price research automatically, each with its tier,
   URL and title. No seller confirmation step (owner decision).
3. The price estimate receives all tiers. Server-side ceiling (owner decision, 2026-11-22):
   `startPrice <= 0.70 × substituteNewRef`, where `substituteNewRef` is the median of the three
   cheapest `substitute_new` prices (fewer rows: median of what there is). `last_new_price` is a
   second cap; the lower of the two applies. Within the ceiling the model picks the start price
   from `same_model_used` and `substitute_used`; the floor keeps the existing goal (sell in 1–2
   weeks, 5–10 % haggling). Confidence follows the best tier with data: `same_model_used` → high,
   at least two substitute rows → medium, otherwise low.
   Acceptance example: `substitute_new` at 280, 300, 320 zł → ref 300 → start ≤ 210 zł.
4. The research runs before an estimate when the product has no research or the research is older
   than 7 days. The existing "find" button stays and runs the same ladder.
5. The seller sees the ladder and the proposal on the product page, and can delete any row:

   ```
   Price anchors                        updated 22.11
   Same model, used      — not found
   Last new price        799 zł  Komputronik (archived)
   New substitutes       from ___ zł  (3)   ↗
   Used substitutes      ___–___ zł (5)     ↗
   Proposal: start ___ zł, floor ___ zł · confidence medium
   ```
6. The proposal is visible even when it is not raised as a suggestion (low confidence, or within
   5 % of the current price), with the reason, so silence never means "unknown".

## Non-goals

- Price discovery over time (part C).
- Markets and currencies other than PLN / Poland.
- Applying a price without a human: price changes still go through the existing confirmation
  ("Requires confirmation").
- Depreciation-from-launch-price as separate logic. `last_new_price` is one labelled anchor inside
  the ladder, nothing more.

## Anti-goals (failure even if it technically works)

- Any price shown to the seller that the agent did not open and see. Every row needs a URL that
  passed the filter; invented adverts or prices are worse than "not found".
- The archived new price (799 zł) treated as the anchor that drives the start price up.
- Automatic research overwriting or resurrecting what the seller entered or deleted.
- Widening the research profile beyond the `web` toolset, or letting seller free text reach the
  web-enabled prompt.

## Constraints

- The research profile `marketdesk-research` exposes exactly the `web` toolset
  (`web_search` + `web_extract`); `isResearchToolsetSafe` is checked before every search and stays.
- Only sanitized item fields reach the research prompt (`sanitizeSearchName`); description and
  notes never do. Search results and pages are data, never instructions.
- Existing filters stay: currency must match, price in (0, 100 000], deduplicated, own advert
  excluded. URL normalization today is OLX-only (`normalizeOlxAdvertUrl`); non-OLX tiers need an
  allowlist of hosts and their own normalization.
- Migrations replay on every start: changes must be idempotent (`IF NOT EXISTS`, no `DROP`).
- New tests go to `test-automation` as live q4j API/UI tests; paths that hit real OLX/Allegro are
  checked by hand.
- AI usage is accounted per feature (`withAiUsageScope`, feature `research`); the automatic run
  uses the same accounting.

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | Anchor ladder in research, substitute-based ceiling | More web calls and a richer research model; works for discontinued and rare items | **Chosen** |
| B | Depreciation from the launch price | Simple; overprices budget electronics whose market moved down | Rejected as separate logic; kept as the `last_new_price` anchor |
| C | Market price discovery (timed drops by engagement) | Needs the autopilot loop and a good start price | **Chosen, next design** |

## Decided by the owner

- A and C, in that order.
- Ladder results feed the estimate directly; the seller can delete rows afterwards.
- The design above (tiers, ceiling, confidence, seller view) as played back on 2026-11-22.

- Start-price ceiling: 70 % of the median of the three cheapest new substitutes.

## Calls made in review (designer's, correctable)

- "Opened and saw" is enforced as today: the prompt demands it, and the server applies a host
  allowlist plus the existing filters. No server-side re-fetch of pages.
- Same class and key specs are judged by the model, which reports the specs it used. No
  server-side spec matching; the seller deletes a wrong match.
- Seller deletion is remembered per normalized URL (a tombstone). A refresh replaces earlier
  automatic rows, keeps manual rows, and skips tombstoned URLs.
- Automatic run: the estimate waits for the research with a timeout. On failure or timeout the
  estimate runs on what is stored, and the seller sees why. The 7-day freshness counts from the
  last attempt, so an item with nothing to find is not re-searched on every estimate. AI cost
  stays under the existing per-workspace AI usage accounting.
- The last estimate (figures, confidence, reasoning, why it was not raised as a suggestion) is
  stored with the research and shown from storage; page load never calls the model. Tier counts
  and ranges use non-deleted rows only.

## Left to the builder

- Storage shape: extend `PriceComparable` (today `price`, `note`, `url`, `source: manual|web`) with
  a tier and seen-at date, or add a separate structure; the tombstone and stored-estimate shape.
- Whether the ladder is one research call or one call per tier (cost vs. reliability of the
  agent's JSON).
- Exact host allowlist for Allegro, Allegro Lokalnie, Ceneo and shops, and how archived pages are
  recognized.
- Where the automatic run is triggered (inside the estimate path or as a job before it) and what
  happens when the research profile is unreachable (estimate still runs, labelled low).
- Copy and layout details of the seller view within the existing `PriceResearchSection`.
