# Sale verdict graph — design (step 1 of 3)

Date: 2026-11-22. Status: draft for owner approval.

## Intent

MarketDesk is moving every AI action onto LangGraph graphs: narrow Hermes calls as nodes, code
checks between them. Graphs gave better results than single large prompts (price research, PR 502).
The owner wants the AI actions that are still on the old implementation moved to graphs and the old
code removed. The quality target is the **sale verdict**: is this product ready to be sold?

The owner's definition of a sale verdict, in their words: the product has enough information filled
in, a fair price for the sale, photos, and the photos have information that should not be shared
with buyers blurred out.

Autopilot is **not** connected in this work. The verdict must only make it possible to continue
there later.

## Roadmap (agreed order)

1. **This document.** The sale verdict graph with the info, price and photo-count checks; the old
   decision engine and the single-call AI paths are removed.
2. Photo safety check, detect only: a vision-capable model finds sensitive content on each photo and
   the verdict says which photo and what. Separate design.
3. Redaction: MarketDesk blurs the found areas itself, keeps the original, sends the processed copy
   to OLX. Separate design.

## Where things are today (origin/main at 8cdb0cf0ef)

| Button | Path | State |
|---|---|---|
| Analyze (catalogue row, product page) | `RunHermesUseCase` → `HermesDecisionEngine.runProductSeo` (domain service, 685 lines) | Not a graph. SEO call + price estimate from stored research + conditions → `HermesEvent`s with autonomy tiers. Synchronous HTTP. |
| Refresh price research | `PriceResearchGraph` via `priceResearchQueue` | Real graph. Keep. |
| Buyer reply drafts / Regenerate | `ConversationReplyGraph` | Real graph. Out of scope. |
| AI draft of a new product | `ProductAssistanceGraph` → `draft` → `ProductAIDraftService` | One-node wrapper. Out of scope for step 1. |
| Recheck | `ProductAssistanceGraph` → `publication` → `ProductRecheckService` | One-node wrapper, deterministic checks. |
| Improve | `ProductAssistanceGraph` → `improve` → `analyzeListingSeo` + `suggestPrice` | One-node wrapper. Prices from a single prompt, not from research. |
| Revival proposal | `ProductAssistanceGraph` → `revive` → `analyzeListingSeo` + `suggestPrice` | Same single-prompt price. |

Problem this exposes: two price paths. Analyze prices from research; Improve and Revive price from
one `suggestPrice` prompt. The same item can get different prices depending on the button.

## Goals

- One **sale verdict graph** per product that runs the checks and stores a verdict.
- One price path everywhere: the research-based estimate.
- Remove `HermesDecisionEngine`, the Improve button and its graph branch, and `suggestPrice`.
- Leave clear extension points for autopilot (step after 3) and photo checks (steps 2–3).

## Non-goals

- Connecting autopilot: no auto-apply, no autonomy-tier decisions on the verdict, no scheduled
  price drops, no catalogue-wide periodic runs.
- Photo content analysis (step 2) and redaction (step 3).
- Moving the new-product AI draft or the buyer reply graph.
- LangGraph checkpointer and `interrupt` (they come with autopilot, issue 484).

## Anti-goals

- A verdict that reads "ready" while the price is a guess. Weak research must yield
  `needs_human`, never a made-up price.
- A verdict stitched from checks of different moments without saying so.
- Seller free text or Hermes text in graph state or logs (same rule as the existing graphs).

## Approaches considered

1. **Verdict graph as an orchestrator, run in the background, verdict stored** — chosen. Analyze
   enqueues a run; the graph runs the checks and stores a versioned verdict with reasons; the UI
   reads it. Gives autopilot something to read and is the natural place for a later checkpointer.
   Cost: a new table and a verdict UI; Analyze no longer answers instantly.
2. Rewrite the decision engine as a graph behind the same synchronous endpoint. Cheapest, no UI
   change, but photo analysis would hit HTTP timeouts and there is no verdict entity for autopilot.
3. One small graph per check, verdict computed on read. Checks can run independently, but the
   verdict mixes results of different ages and is hard to version.

## Design

### Graph

`SaleVerdictGraph` (`src/backend/application/services/SaleVerdictGraph.ts`), version constant
`sale-verdict@1`, built like `PriceResearchGraph`: zod schema per Hermes node, a transition observer
(node lifecycle only), `withAiUsageScope({ feature: 'verdict' })`.

```
                     ┌──── scope ─────┐
START → load → route ┼→ info          ┼→ combine → save → END
                     ├→ price         ┤      ↑
                     │   (→ research) │   checks outside the scope come
                     └→ photos ───────┘   from the latest stored verdict
```

**Composable checks (owner requirement).** AI actions are a chain of graphs bound to buttons, and
some buttons must run only part of the chain — e.g. "Review price" runs only the checks that decide
whether the price is fair, not the whole analysis. So:

- `info`, `price` and `photos` are each a **self-contained compiled subgraph** with its own input
  (what it loads) and the same output shape: `{ check, status, reasons[], checkedAt, refs }`.
  Each can be invoked alone in tests and from other graphs.
- A run takes a **scope**: the list of checks to run. `route` is a conditional edge after `load`
  that fans out only to the checks in scope.
- `combine` takes the fresh results of the checks that ran and the **latest stored result** of
  every other check, then derives the overall status. Each check keeps its own `checkedAt`, and
  the UI shows it, so a verdict mixing a 5-minute-old price with a 2-day-old info check says so
  (this replaces the anti-goal of silent mixing).
- Starting "from the middle" means a narrower scope over fresh data, **not** resuming a past run
  from a LangGraph checkpoint. A checkpointer is for pausing on human approval (autopilot), not for
  buttons.

Button → scope:

| Button | Scope | Notes |
|---|---|---|
| Analyze | `info`, `price`, `photos` | Full verdict |
| Review price (new) | `price` | Research if stale, then estimate and the fair-price rule |
| Recheck | `info` (code checks only, no Hermes call) | Pre-publish; synchronous as today, also writes its check into the verdict |
| Refresh price research | — | Stays the research graph alone; the next `price` run uses its result |
| Future AI buttons | new subgraph + a row here | The way every new AI action is added |

- **load** (code): product, its OLX listing (primary listing as today), marketplace. Missing
  product → run fails as not found.
- **info**:
  - code: condition known; required OLX category attributes filled; title fits the OLX limit
    (`fitsOlxTitle`); description not empty; category and publish eligibility (the checks
    `ProductRecheckService` runs today, reused, not copied).
  - Hermes (one narrow call, the existing `analyzeListingSeo` contract): proposed title,
    description and attribute fixes when code found gaps or the copy is weak.
  - result: `ready` / `fix` with the list of gaps; proposals become `HermesEvent`s of the existing
    types (`suggested_better_title`, description) for accept/dismiss, as today.
- **price**:
  - If stored research is missing or older than the freshness window, run `PriceResearchGraph`
    inline as a subgraph and wait for it (the run is recorded through `PriceResearchRuns` so the
    research UI shows it).
  - Then the existing estimate (`PriceEstimateService.estimate`): ceiling, seller floor,
    confidence, completeness.
  - **Fair price rule ("max price"; Claude's call, the owner did not object):** the listing price is fair when it is at or below
    the market ceiling and at or above the seller floor. Above the ceiling → `fix` with the ceiling
    as the proposed price (existing price-change event). Below the floor → `fix`.
  - Low confidence or incomplete ladder → `needs_human`, no proposed price.
- **photos** (code, step 1): photo count ≥ minimum → `ready`, otherwise `fix`. The node returns the
  same check shape the step-2 vision node will return, so step 2 replaces its body only.
- **combine** (code): overall = `needs_human` if any check is `needs_human`, else `fix` if any is
  `fix`, else `ready`. Every check carries a machine reason code plus a short display message.
- **save** (code): one row per run.

Checks in scope run in parallel after `load`; one check failing (Hermes down, timeout) marks that check
`needs_human` with reason `check_failed` and does not fail the verdict.

### Storage

New table `product_sale_verdicts` (new migration file, `CREATE TABLE IF NOT EXISTS`; migrations
replay on every start, never append a DROP): `id`, `workspace_id`, `product_id`, `listing_id`,
`graph_version`, `scope` (text[]), `status` (`queued|running|completed|failed`), `overall`
(`ready|fix|needs_human`), `checks` (jsonb: per check `status`, `reasons[]`, `checkedAt`, and for
price the research id it used), `created_at`, `completed_at`. The latest completed row is the
product's verdict.

### Running

- New queue `saleVerdictQueue`, handler like `priceResearchQueue`'s; one active run per product
  (a second Analyze while running returns the running one).
- `POST /hermes/products/:productId/run` keeps its path (catalogue and product page already call
  it) but now enqueues a verdict run and returns the run; it accepts an optional `scope` (default:
  all checks). `GET` endpoint for the latest verdict. "Review price" calls the same endpoint with
  `scope: ['price']`.
- One active run per product regardless of scope: a second request while a run is active returns
  the active run.

### UI

Catalogue row and product page show the verdict:

```
AirPods Pro 2   ● Not ready   Info ✓  Price ✗ 349 → 279 zł  Photos ✓(4)   [Analyze]
                └ Price above the market ceiling: used same model 240–290 zł
```

While a run is in progress the row shows it as running; the page polls until completed. The
"needs action" tab (PR 497) keeps working off pending events.

### Removed

- `HermesDecisionEngine` and `RunHermesUseCase`'s call into it.
- Improve: the button on the product page, the `improve` branch, `POST /products/:id/improvements`,
  its frontend mutation.
- `IAIProvider.suggestPrice` and its adapters; `ProductAssistanceExperiment`'s use of it.
- Revival proposal price: from the research estimate instead of `suggestPrice`.
- The autonomy-tier code paths of the engine go with it; the workspace setting stays (autopilot will
  read it later).

Recheck stays as the pre-publish button; its logic is shared with the info node.

### Details settled after the builder check (Claude's calls)

- **Price inputs.** Ceiling and floor are the estimate's `startPrice` and `floorPrice`
  (`PriceEstimate`), not a seller-entered value. No OLX listing or no listing price → price check
  `needs_human` (`no_listing` / `no_price`), and `listing_id` is nullable. The inline research run
  failing → `needs_human` with `check_failed`; it finishing with low confidence or an incomplete
  ladder → `needs_human` with `weak_research`. Same outcome, different reason codes.
- **Research already running.** If a research run for the product is queued or running (from
  Refresh), the verdict waits for that run instead of starting another (`PriceResearchRuns` is the
  single owner of research runs).
- **Events and autonomy.** Per-product Analyze already creates every event as `pending_review`;
  auto-apply lives only in the workspace-wide `HermesDecisionEngine.run`, which no route reaches.
  So nothing changes for users: the verdict's proposals are `pending_review` events, and the
  unreachable workspace run is deleted with the engine. Engine outputs: `suggested_better_title`
  and description → info node; price events → price node; `price_estimate_unavailable` → price
  reason code; `suggested_more_photos` → photos node; `needs_relisting` is dropped (Revive covers
  expired adverts).
- **`suggestPrice` users.** The new-product draft does not call it. Remaining users (Improve and
  Revive branches, Hermes and offline adapters, `AIProviderSelector`, testkit, the experiment) are
  removed or switched. Revive takes the stored research estimate when there is one; with none it
  offers no price (the existing `price` ai-issue) and never runs research inline.
- **Staleness.** A verdict is a snapshot. When the product's or listing's `updatedAt` is later than
  the verdict's `completed_at`, the UI marks it "out of date, run Analyze again". No automatic
  re-run after accepting a proposal (that belongs to autopilot).
- **Failures and stuck runs.** A `failed` run never hides the previous completed verdict; the UI
  shows that verdict plus "last run failed". A run left `queued`/`running` past a TTL is treated as
  failed, using the `PriceResearchRuns` TTL pattern.
- **API consumers.** `POST /hermes/products/:id/run` returns the run (id, status). Every consumer is
  updated in the same change: `hermesApi` and its test, the backend integration and abuse-limit
  tests, and q4j `ProductService` / `PriceResearchService`. The catalogue list response carries
  each product's latest verdict (joined, not one request per row).
- **Retention.** Keep all rows for now; the table is small (one row per Analyze).

### Extension points for later

- Step 2 replaces the `photos` subgraph body with a vision call per photo, same check shape.

### What this gives autopilot, and what is left for it

Given by this work (verified against the code):

- A stored verdict with per-check reasons and `checkedAt` — the input for decisions.
- Scoped runs — autopilot can re-run only `price` on a schedule.
- Proposals stay `HermesEvent`s, applied by `ApproveHermesEventUseCase` (including the OLX price
  send), which does not depend on `HermesDecisionEngine`; autopilot can apply through the same path.
- `graph_version` on every verdict, so autopilot decisions can be traced to the logic that made them.

Left for the autopilot project (not in this work):

1. Triggers: schedule and OLX signals (expired, no views, new message, N days passed).
2. Decision policy: which verdict and autonomy level (`suggest_only|balanced|full_auto`, setting
   already exists) applies a change itself versus asks.
3. Human gate: LangGraph `interrupt` + Postgres checkpointer (issue 484).
4. Guardrails: never below cost, at most K price changes per week, nothing while in moderation.
5. Photo steps 2–3, without which `ready` is incomplete for full autopilot.

## Decided by the owner

- Verdict = enough info + fair price + photos present + sensitive photo content hidden.
- Approach 1 (background orchestrator graph, stored verdict).
- Photo work: detect first, redact later (steps 2 and 3).
- Autopilot not connected now; only extension points.
- AI actions are composable: each check is its own subgraph, buttons run a scope of checks
  (e.g. "Review price" runs only the price checks), and new AI buttons are added the same way.

- (planning, 2026-11-22) The separate price-research job is legacy behaviour: research becomes a
  node of the price subgraph, run inline; "Refresh price research" is a `price` scope run that
  forces research. Recheck runs the info subgraph code-only and writes its check into the verdict.

## Calls made by Claude (open to correction)

- Fair price = at or below market ceiling, at or above seller floor; weak research → `needs_human`.
- Improve button removed rather than repointed; Recheck kept for pre-publish.
- Analyze endpoint path kept, behaviour becomes enqueue.

## Left to the builder

- Research freshness window and minimum photo count (constants; propose values in the plan).
- Exact reason codes and display texts.
- How the verdict UI polls (RTK Query polling vs refetch on focus).
- Test layout, following the project rules (q4j API/UI tests in test-automation).
