# Justified price estimate for the product AI analysis

Date: 2026-11-21. Status: approved by the owner. Part 1 of 2; part 2 (a 14-day price-drop schedule
driven by OLX signals) is designed separately together with issue #484.

## Why

The owner wants the AI analysis button on a product to propose a price they can trust, so that a
used item sells within 1–2 weeks with little haggling (5–10 %).

A production check on 2026-11-21 (AirPods 4 MXP63ZM/A, no ANC, like new, 399 PLN, 16 views,
0 messages) showed the button cannot do that today:

- `HermesAI.suggestPrice` sends only the current price, views, a hard-coded 0 % conversion and
  "No competitor price observed". Name, model, condition, contents, category and description are
  missing. Hermes answered "keep 399" with low confidence three times out of three.
- `HermesDecisionEngine` shows a price suggestion only when confidence is `high`, so no price
  suggestion reached the interface at all.
- With the product card in the prompt Hermes answered 329 PLN (medium/low confidence). Market
  research the same day put new retail at about 429–600 PLN and used no-ANC asks on OLX at about
  200–285 PLN, so a sensible answer is a start near 279 PLN and a floor near 250 PLN.

The OLX Partner API does not expose other sellers' adverts or category price statistics, so used
prices cannot come from OLX through the partner integration.

## The three levels

1. **New retail anchor** — the ceiling. A used item cannot sell above the new price.
2. **Used range** — the realistic band for this condition and contents.
3. **Marketplace signal** — how the live advert responds (views, watchers, conversations, days live).

## Goals

- The analysis returns a **start price** and a **floor price**, each with reasoning in numbers.
- Every figure is labelled **observed** (from data MarketDesk holds or the seller entered) or
  **estimated** (the model's own knowledge), with a confidence level.
- The suggestion is visible at confidence `medium` or higher, with the confidence shown.
- Nothing is applied to a live advert without the owner's approval in this part.

## Non-goals

- Scraping OLX or any other site, including the olx.pl site search API.
- The price-drop schedule over time (part 2).
- Giving the Hermes profile tools or web access; it stays the no-tools `marketdesk` profile.
- Choosing an external retail-price provider (deferred; the anchor field takes a source label so a
  provider can fill it later without a redesign).

## Anti-goals

- A confident-looking number that is really a guess: an estimated figure must never be presented
  as observed.
- A suggestion that raises the price above the new retail anchor.

## Design

- **Retail anchor on the product**: new optional fields — new retail price (amount, currency),
  source label and date. Entered by hand for now. Empty → Hermes estimates it and marks it
  estimated.
- **Seller comparables**: optional list of comparable asking prices the seller pastes (price,
  short note or link text). Sent to the prompt as observed figures. They are seller data and go
  through the same prompt-safety handling as other seller text.
- **Prompt**: product name, model, condition, contents/description summary, category path, city,
  retail anchor (with its label), comparables, days since the advert went live, views, watchers,
  conversations. The hard-coded conversion rate goes; real counters are passed as they are, and
  unavailable counters are passed as unavailable, not as zero.
- **Answer shape**: `startPrice`, `floorPrice`, `retailAnchor` (value + observed/estimated),
  `usedRange` (low/high + observed/estimated), `reasoning`, `confidence`. Validation: numbers
  finite and positive, `floorPrice <= startPrice <= retail anchor`; an invalid answer produces no
  suggestion and a visible "could not estimate" note, never a silent fallback to the current price.
- **Surfacing**: a price suggestion appears when confidence is `medium` or `high` and the start
  price differs from the current price by at least 5 %. The card shows start, floor, the anchor
  and range with their labels, and the confidence. Approving applies the start price through the
  existing approval path; autonomy and guardrails (`maxAutoPriceChangePct`) are unchanged.

- **Discount against new** (owner request, 2026-11-21): wherever a retail anchor exists, the
  product page shows the current price as a percentage of it (`−41% vs new`, with source and date),
  and the price suggestion card shows the same for the proposed start price. The anchor never
  writes to `cost_price`: that field means the seller's own cost and drives the below-cost
  confirmation and the `minMarginFloor` guardrail, which a retail price would trip on every used
  item.

## Acceptance check

Replay the AirPods analysis on production after deploy: expect a start near 279 PLN and a floor
near 250 PLN (not 399/329), labels present, and the suggestion visible in the product page.

## Left to the builder

Storage layout of the new fields (migrations re-run on every start, so they must be idempotent),
DTO and UI placement of the anchor and comparables inputs, exact prompt wording, and the test split
(unit tests for prompt building and answer validation; live q4j API test for the endpoint).
