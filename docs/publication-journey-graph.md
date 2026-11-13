# Product creation and publication journey

The first graph-backed sales workflow covers the product creation path through a queued listing publication. It is versioned as `publication-journey@2` in the UI and `publication-preflight@1` on the server. It does not add LLM decisions, autonomous publication, or a new provider action.

```text
Photos → Review and publish (fields, price, OLX category) → Publish to OLX
  → product saved → listing draft → category saved → publication preview
  → nothing blocks → publication queued → existing marketplace worker
  ↘ something blocks → owner review dialog → publication queued
                               ↘ blocked (fix and preview again)
```

The seller confirms the OLX category on the review screen of the wizard: the search-as-you-type picker offers leaf categories and "Publish to OLX" stays disabled until one is chosen. Pressing it is the single human confirmation of the publication.

The browser keeps only the short-lived presentation transition state. It saves the product through the existing API and passes the marketplace, product ID, chosen category and the wizard approval to the product page. That page creates or finds one listing draft, saves the chosen category and fetches the publication preview. It queues the publication without a second dialog only when all three hold: the wizard approved it, the preview says it can publish, and the preview's category is the one chosen in the wizard. Otherwise it opens the existing review dialog. After queueing, the page refetches the listing every 5 seconds for up to 2 minutes and shows a failure reported by the worker in full. Refreshing the page or closing the dialog leaves the product/listing facts in MarketDesk; the user can restart the existing review from the listing table. The browser state is not a durable checkpoint or a source of authority.

The server uses LangGraph for the deterministic publication preflight: scoped data load → listing/product eligibility → OAuth account → OLX category → OLX quota authorization. Each node calls the existing MarketDesk domain and application checks. Only a successful graph run queues the existing publish job and records `listing.publish_requested` with the workflow version. The marketplace worker and its existing publication fence, idempotency, status reconciliation and audit semantics remain authoritative. A provider response can still fail after queueing; the UI must not call a queued request a live advert.

For OLX, the wizard picker searches leaf categories through the connected marketplace, and the review dialog searches them for the listing, both from the authenticated provider taxonomy. A selection is verified against the current category detail and full path before it is saved to the listing. A fresh preview is fetched afterward. When the dialog opens, the seller must explicitly confirm the exact category there; a quota override still needs the existing fee-risk checkbox and reason, and non-quota blockers cannot be overridden. Every publish/relist call runs the server checks again, so stale browser previews cannot grant permission.

The graph is deliberately stateless between HTTP requests in this slice. The durable product, listing, quota operation and queued job stay in MarketDesk. Persistent LangGraph checkpoints, a versioned sales-agent recipe, buyer conversations and autonomous actions belong to later implementation tasks after the wider #290 concept is approved.

## Product assistance graph

`product-assistance@1` is a second backend LangGraph. It routes a seller request to one of three bounded actions: create an editable AI draft, run the guarded publication recheck, or propose product copy and price improvements. The graph calls the injected `IAIProvider`; production DI supplies the existing Hermes adapter, which authenticates to the Hermes API with `HERMES_API_KEY`. A future provider can implement the same port. Credentials never enter graph state.

Copy and price output is review-only. The seller must use the existing product/listing editing controls to apply a suggestion; normal domain price rules and publication approval still apply. Improvement requests load product and listing with workspace scope and return observed update timestamps so the UI can hide stale proposals. This graph has no durable checkpoint, automatic edits, or automatic publication.

## Offline experiment lifecycle

The next implementation slice provides [versioned local experiment bundles and decision drafts](sales-agent-experiments.md) for the product assistance improvement route. It runs synthetic fixtures through the real graph, records node lifecycle and provider calls, and evaluates contract/security regression gates. It adds no durable workflow checkpoint or production autonomy.
