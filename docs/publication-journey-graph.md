# Product creation and publication journey

The first graph-backed sales workflow covers the existing product creation path through a queued listing publication. It is versioned as `publication-journey@1` in the UI and `publication-preflight@1` on the server. It does not add LLM decisions, autonomous publication, or a new provider action.

```text
Photos → Basic info → Pricing → Category → Marketplace → Review
  → product saved → listing draft → publication preview
  → owner review → publication queued → existing marketplace worker
                               ↘ blocked (fix and preview again)
```

The browser keeps only the short-lived presentation transition state. It saves the product through the existing API and passes the selected marketplace and product ID to the product page. That page creates or finds one listing draft and opens the publication preview. Refreshing the page or closing the dialog leaves the product/listing facts in MarketDesk; the user can restart the existing review from the listing table. The browser state is not a durable checkpoint or a source of authority.

The server uses LangGraph for the deterministic publication preflight: scoped data load → listing/product eligibility → OAuth account → OLX category → OLX quota authorization. Each node calls the existing MarketDesk domain and application checks. Only a successful graph run queues the existing publish job and records `listing.publish_requested` with the workflow version. The marketplace worker and its existing publication fence, idempotency, status reconciliation and audit semantics remain authoritative. A provider response can still fail after queueing; the UI must not call a queued request a live advert.

For OLX, the review dialog can search leaf categories by name from the authenticated provider taxonomy. Selection is verified against the current category detail and full path before it is saved to the listing. A fresh preview is fetched afterward. The seller must explicitly confirm the exact category; a quota override still needs the existing fee-risk checkbox and reason, and non-quota blockers cannot be overridden. Every publish/relist call runs the server checks again, so stale browser previews cannot grant permission.

The graph is deliberately stateless between HTTP requests in this slice. The durable product, listing, quota operation and queued job stay in MarketDesk. Persistent LangGraph checkpoints, a versioned sales-agent recipe, buyer conversations and autonomous actions belong to later implementation tasks after the wider #290 concept is approved.
