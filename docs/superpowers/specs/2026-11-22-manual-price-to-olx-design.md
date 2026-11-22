# Manual price changes reach OLX

Date: 2026-11-22. Status: approved by the owner (short design).

## Why

On 2026-11-21 the owner wanted AirPods 4 at 318 PLN. MarketDesk sends a price to OLX only when a
Hermes price suggestion is approved; both manual edits — the listing price dialog
(`PATCH /listings/:id`) and Edit product (`PATCH /products/:id` with `sellingPrice`) — change
MarketDesk only, and the dialog even says "Listing price updated." while OLX keeps the old price.
The owner chose: every manual price change behaves like a Hermes approval.

## Approaches

1. **One shared price-change service** (chosen): the Hermes approval's price logic — new price on the
   product and every listing, price history, OLX update job for live listings — moves into a service
   used by the Hermes approval, the listing price dialog and Edit product.
2. A separate "send to OLX" button after saving — rejected: two steps, easy to forget, the AirPods
   divergence again.
3. Hourly background sync of divergent prices — rejected: up to an hour late, unclear who changed what.

## Behaviour

- A manual price change (either place) sets the product's selling price and every listing's price,
  records price history with `changedBy: 'user'`, and queues the OLX update for live OLX listings
  exactly as the Hermes approval does (the update rewrites the whole advert from MarketDesk data).
- Same price as now → nothing is sent to OLX (no needless advert rewrite).
- Below the product's minimum acceptable price → refused, manually too (lower the minimum first).
  The existing below-cost confirmation in Edit product stays.
- Only live OLX listings get the update; drafts and ended listings change in MarketDesk only.
- The Hermes approval uses the same service; its behaviour does not change.
- Responses tell the interface what happened, so it can say "Price 318 zł saved and sent to OLX" or
  "saved; OLX not connected — not sent to OLX". The price dialog states that the price will also be
  updated on OLX and that the advert is rewritten from MarketDesk data.

## Non-goals

Sending other manually edited fields (title, description) to OLX; a transaction around save +
history + queue.

## Acceptance

- q4j API on the sandbox OLX stand: changing a live listing's price queues an update; changing the
  price in Edit product moves the listing price too and queues an update; the same price queues
  nothing; a price below the minimum is refused.
- Production by hand: AirPods 4 set to 318 in MarketDesk shows 318 on olx.pl.
