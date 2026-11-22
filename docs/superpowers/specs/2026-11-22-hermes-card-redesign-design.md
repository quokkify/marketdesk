# One Hermes card on the product page — design

**Status:** draft, waiting for the owner's review of the clickable prototype.
**Related:** issue #496 (product detail UX audit), the price research graph and sale verdict graph designs of 2026-11-22.

## Intent

The product page shows three AI blocks as separate rail cards: Price research, Sale verdict, and Hermes
(suggestions plus the publication check). The owner cannot act from the page comfortably:

- Price research shows a report and a manual form at once; it is unclear what the numbers mean.
- "Find prices" does not read as the action to take.
- Sale verdict fits its checks in one line and does not say that its price check depends on price research.
- There is no log of a run and no history of earlier runs.
- Hermes, the product's main feature, starts about 1000 px down the rail.

The goal is one Hermes block directly under Statistics that answers "is this product ready to sell, and what
do I do next", with the details, the run log and the history one click away.

## Goals

- One Hermes card in the rail, placed after the price card and Statistics.
- The card states the verdict, the leading reason, and one primary action for the current state.
- The card shows that the price check reads the market prices.
- One button runs everything; the seller does not need to know that price research runs first.
- A live view of a running analysis, and a history of finished runs with their steps.
- Price research is a report by default. The seller can still add prices they found themselves.

## Non-goals

- The rest of the page restructure from #496 (summary above the gallery, responsive gallery and listings,
  accessibility tokens). This design is compatible with it and makes the rail shorter.
- Changes to the price research graph or the sale verdict graph.
- A workspace-wide run history; the Hermes activity page stays as it is.

## Anti-goals

- A taller rail. The three cards are replaced, not joined end to end.
- A second place where the same verdict or price is stated.
- Losing prices the seller entered by hand.

## Constraints

- The rail is 300–360 px wide; anything that needs a table or a form does not belong in it.
- `price_research_runs` and `product_sale_verdicts` already keep history, including the per-step state of a
  research run (`nodes`). The API exposes only the active and the last run of each.
- A market search keeps every row whose source is not `auto` (`mergeLadder`), so the seller's prices survive.
- New tests are live q4j tests in `test-automation`; frontend unit tests cover pure functions only.

## Approaches

1. **Compact card in the rail, details in a side drawer (chosen).** The card holds the verdict, the action
   and five rows: Market prices, Price, Info, Photos, Suggestions. Each row opens a drawer on the matching
   tab: Market prices, Checks, Suggestions, Log and history. The rail gets shorter, the seller keeps the page
   in view, and the drawer is wide enough for the price table, the add-price form and the run log.
2. **A Hermes tab on the product page.** Room for everything, but the verdict leaves the first screen and
   the seller has to switch tabs to see price and Hermes together. It also competes with the #496 summary.
3. **Expandable sections inside one rail card.** No new surface, but the open card is as tall as the three
   cards are today, and a 30-row price list plus a run log do not fit 330 px.

The owner handed the choice over; approach 1 is the author's call and is what the prototype shows.

## The card

Rail order: price card, Statistics, Hermes. The Activity card is removed from the rail; its Hermes events
are covered by the history tab (price-change events stay in the price history card in the main column).

- Header: "Hermes" and one status chip — Not analysed, Analyzing n/8, Not ready, Ready to sell.
- Lead line: the leading reason of the verdict, with the figures ("250 zł → 169 zł").
- Actions by state:
  - never analysed: **Analyze product**;
  - not ready because of price: **Set price to {proposed}** and Analyze again;
  - ready: Analyze again (Publish stays the primary action of the price card);
  - running: disabled "Analyzing…".
- Rows, each with a status mark, a value and one line of detail:
  - **Market prices** — start price; floor, number of prices, age of the search, confidence.
  - **Price** — current price, or current → proposed; "Uses the market prices from {age}". A connector
    joins it to the Market prices row.
  - **Info**, **Photos** — result and one line.
  - **Suggestions** — number waiting.
- Footer: time of the last run and a "Log and history" link.

While a run is in progress the rows show waiting, running and done per step, and the lead line names the
current step. Staleness and "last run failed" keep their current rules and appear as the chip and lead line.

## The drawer

- **Market prices.** Four figures (start, floor, new, used range), one line on the discount and on why the
  confidence is what it is; the prices Hermes found, grouped by kind, each with its link; the matching
  explanation collapsed; **Search again**. Then **Your prices**: a list and a small form — price, kind
  (same model used, last new price, new substitute, used substitute), optional link, date seen. The retail
  "price of a new one" fields become a manual price of kind "last new price".
- **Checks.** Price, Info, Photos as full rows with every reason and the fix action. The price row links to
  the Market prices tab. The publication check (required fields, OLX category) sits below.
- **Suggestions.** The current recommendation queue with Apply and Dismiss.
- **Log and history.** Finished and running runs of this product, newest first: when, what started it
  (Analyze, Find prices, Autopilot), duration, outcome. A run expands to its steps: identify the model, the
  four price searches, the three checks, each with its result or its error in plain words.

## Backend

- `GET /products/:id/price-research/runs?limit=` — finished and active research runs with `nodes`.
- `GET /hermes/products/:productId/verdicts?limit=` — verdict runs with `checks`.
- The frontend joins the two lists by time into one history. A verdict run that started a research run is
  shown as one entry when the research run's trigger is `analyze` and the times overlap.
- No schema change. Per-step timestamps are not stored today; the log shows step results without times
  unless the builder finds them cheap to add.

## What is left to the builder

- Component split of the new card and drawer, and what is reused from `PriceResearchSection`,
  `VerdictSummary` and `ProductHermesCard`.
- Polling cadence while a run is active.
- Page size and "show more" of the history.
- Exact copy, within the vocabulary above.

## Open after the prototype review

The owner reviews the prototype and says what is wrong. This document is updated before a plan is written.
