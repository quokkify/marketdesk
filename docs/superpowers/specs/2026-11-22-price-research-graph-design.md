# Price research as a graph, with class checks and completeness

Status: approach approved (graph; completeness for pricing only; any `.pl` shop host), design for planning.
Builds on `2026-11-22-price-anchor-ladder-design.md` (PR #494, deployed as sha-b444ae1ad87f).
Owner direction: Hermes + LangGraph is the core of MarketDesk.

## Intent

The anchor ladder shipped, but on the real case it found the wrong thing. For the AOPEN QH11
(native 720p, 200 ANSI lm mini projector, remote missing) the one-call research returned a
BenQ W600 (2500 lm home-cinema projector, 590 zł) as the only substitute; the start price the seller
saw felt far too high. An independent research run on a stronger model (Fable) found real
substitutes (QH15s successor, Extralink, Philips NeoPix, KIANO; 119–399 zł new, 150–215 zł used)
and recommended start 169 zł / floor 125 zł with the remote missing.

Goal: the agent on Hermes reaches a comparable answer on its own, so the autopilot can price items
correctly.

## Evidence (spike on the `marketdesk-research` profile, model gpt-6-luna, 2026-11-22)

| Run | Time | Result |
|---|---|---|
| Prod (one call, generic prompt) | ~60 s, 13 tool calls | BenQ W600 2500 lm only; two other rows dropped by the host allowlist (mercateo.com.pl, a search-engine card) |
| A: one call, Fable-style steps + class rule | 58 s / 135 s | correct class (720p, 140–350 ANSI): Extralink 273/379, Byintek 299, Zenwire 360 new; Magcubic 180/200 used. One run returned a 2594 zł "last new price" from e-katalog (wrong currency) |
| B: identify call, then one call for all tiers | 46 s | identify was the best of all (QH12a successor, Strong N1, BenQ GV30, specs with sources); the single search call then found no substitutes |

Conclusions: an explicit strategy plus class rule fixes the class; a separate identify step is
strong; one search call for all tiers is weak, so each tier gets its own node; prices need code
checks (currency, outliers); the host allowlist drops most legitimate shops.

## Goals

1. **`PriceResearchGraph`** (LangGraph, pattern of `ProductAssistanceGraph`: zod schema per node,
   transitions logged) replaces the single research call inside `AnchorLadderService`. The service's
   public contract stays: `refresh(workspaceId, productId)` and `refreshIfStale(...)`, the
   `POST …/price-research/refresh` route, 7-day freshness by last attempt, storage, dismissals,
   merge rules, ceiling and confidence rules from #494.
2. Nodes:
   - **identify** (Hermes research profile, web): exact model; **class attributes** for the item's
     category as a short list of `{ name, value, unit?, match: 'equal' | 'ratio' }` (for a projector:
     native resolution `equal`, ANSI lumens `ratio`); successor/sibling models of the same line sold
     today; 3–5 other-brand models of the same class sold new in Poland, each with its class
     attributes and a source URL.
   - **sameModelUsed**, **lastNewPrice**, **substitutesNew**, **substitutesUsed** (Hermes research
     profile, web), run in parallel after identify. Each searches only its tier and only for the
     models from identify. Every reported offer carries the class attributes of its own product.
     `substitutesNew` counts new items from private sellers on OLX (sealed / with receipt) as well as
     shops.
   - **classFilter** (code): keeps a substitute only when every `equal` attribute matches and every
     `ratio` attribute is within ×0.5–×2 of the item's value; drops it when an attribute is missing
     or unknown. Same-model rows skip this check.
   - **priceSanity** (code): drops a row whose price is not in PLN, and a `last_new_price` row more
     than 3× the median of the kept `substitute_new` prices (when there are any).
   - **merge+save** (code): the existing filter (`filterAnchorRows`), dismissals and `mergeLadder`.
3. Prompts follow the spike's variant A strategy: search OLX search pages
   (`https://www.olx.pl/oferty/q-<words>/`), Allegro Lokalnie search, Ceneo and big shop category
   pages; skip hosts that return 403 to the tools (allegro.pl, mediaexpert.pl, kaufland.pl, alza);
   ignore marketing resolution claims ("supports 1080p/4K").
4. **Host rule** (owner decision): an anchor URL is accepted when its host is on the current
   allowlist **or** ends in `.pl`, and is not on a denylist of non-shops (search-engine result cards,
   price-aggregator mirrors with foreign currencies such as e-katalog). Same-model and used rows still
   need an advert URL (OLX advert, Allegro Lokalnie offer); search-result pages are never stored as
   rows. Normalization rules from #494 stay.
5. **Completeness** (owner decision: pricing only): a new optional product field
   `missingAccessories` (free text, max 200 chars, e.g. "pilot"), edited in the product form, stored
   in migration 052. It reaches **only** the price estimate (no-tools profile, inside
   `sellerDataBlock`), never the web research. The estimate prompt tells the model to lower the price
   for missing items and to name the deduction in its reasoning.
6. The seller view shows, per substitute, the class attributes that matched (e.g. "720p · 200 ANSI")
   and the specs line from identify.

## Execution: a background job, never inside a request

Decided by an arena on 2026-11-22 (owner's request): three independent candidates (Claude Opus,
Fable, Sonnet) and a cross-family judge (DeepSeek-V4-Pro via OMP) all chose a background job.
Base: candidate B; grafts from A and C as marked. Inline execution was rejected: 1.5–4 min per run
does not fit any request budget, and cutting the run to fit brings back the weak one-call result.

**Triggers.** One entry point `PriceResearchRuns.request(workspaceId, productId, { force, trigger })`
replaces `refresh`/`refreshIfStale` for callers; the graph runs only in the worker.

| Trigger | force | Behaviour |
|---|---|---|
| Find prices (`POST …/price-research/refresh`) | yes | enqueue, `202` at once |
| Analyze / workspace run | no | enqueue if eligible, never wait |
| Autopilot / scheduler (later) | no | same call |

Estimate rule: when a successful ladder is stored (fresh or stale), estimate from it now; the job
re-estimates after a run that changed rows. When no successful research exists yet and a run is
queued or running, skip the estimate; the job produces the first one.

**Execution.**
- New Bull queue `price-research` with the same wiring as `conversation-reply` (`createQueue`,
  `registerHandler`, in-process worker), ids-only payload, `attempts: 1`.
- Per-product dedupe by a conditional update in Postgres, not a Bull `jobId` (completed jobs kept
  by `removeOnComplete` would silently swallow later enqueues). A run claims `running` by `run_id`;
  a job whose `run_id` no longer matches exits without calling Hermes. Lease 10 min recovers a
  crashed worker.
- **Run state in its own table** `price_research_runs` (graft from A): `id, workspace_id,
  product_id, trigger, status, nodes jsonb (per-node status), outcome, failed_tiers, error_code,
  queued_at, started_at, finished_at, next_auto_at`. Run-state writes never touch
  `product_price_research.updated_at`, so they cannot cause spurious 409s; history is kept.
- Queue concurrency 1; process-wide limiter of **3** concurrent research calls
  (`HERMES_RESEARCH_MAX_CONCURRENCY`, proven by the spike; raise to 4 after a four-call check);
  at most 10 queued runs per workspace (`429` beyond); workspace AI limits checked at `request`
  (synchronous `429`) and per node.
- Budgets: 180 s per node (the current 120 s client default is below the spike's 135 s), 7 min per
  run, enforced with an `AbortSignal`. identify gets one in-run retry; tier nodes none.
- No seller cancel in v1 (deferred: `DELETE …/price-research/run`, from C). A deleted product makes
  the final save a no-op.

**Failure, partial results, freshness.**
- identify fails after its retry → `failed`, nothing stored. A tier node fails → `partial`; the
  other tiers are saved and the failed tier's stored rows stay untouched. All tiers fail → `failed`.
- `partial` counts as fresh only when at least one substitute tier delivered class-checked rows
  (graft from A); otherwise it is `failed`. A ladder without substitutes is what produced the BenQ
  case.
- Freshness by outcome (replaces "7 days after any attempt"): `ok` → next automatic run in 7 days;
  `partial` → 24 h; `failed` → 1 h doubling to a 24 h cap; not configured / not PLN / unsafe
  toolset → no attempt recorded. Find prices ignores `next_auto_at`; limits still apply.

**Consistency.**
- The ladder save is read-merge-write in one transaction with `SELECT … FOR UPDATE` on the research
  row, merging into the current rows and dismissals at save time; the seller's PUT takes the same
  lock. Edits and dismissals made during a run survive.
- The ladder save bumps `updated_at` (an open clean editor re-keys; a dirty one shows "New prices
  found, reload" instead of discarding input; a stale save still gets 409).
- Every stored estimate carries `researchUpdatedAt`; `saveEstimate` writes only if it is not older
  than the stored estimate's, so an Analyze started before a run ended cannot overwrite the job's
  newer estimate. The job re-estimates through an estimate-only use case extracted from
  `priceEstimateSuggestion` (ceiling, confidence, floor, completeness), replacing the product's
  pending price suggestion; it does not re-run SEO.

**API and UI.**
- `POST …/price-research/refresh` → `202` with the run (idempotent during a run); `404`, `503` not
  configured, `422` not PLN, `429` limits stay synchronous.
- `GET …/price-research` gains `run` (`queued | running` with per-node status), `lastRun`
  (`ok | partial | failed`, `finishedAt`, `failedTiers`, plain reason), `nextAutoAt`, and
  `lastEstimate.researchUpdatedAt`.
- The page polls every 5 s only while a run is queued or running (pattern of `ConversationsSection`,
  `currentData`), shows node progress such as "identifying model…, 2 of 4 searches done" (graft from
  A), and invalidates the product's Hermes events when the run ends. No SSE/WebSocket in v1.

**What the autopilot gets.**
- `request(…, { force: false })` as its only way to start research (shared dedupe, limits, backoff).
- A **price-readiness verdict** (graft from C): `ready` (latest run `ok`, or `partial` with
  substitutes, and the estimate's `researchUpdatedAt` equals the current research version),
  `degraded`, `blocked`; price unattended only on `ready`, otherwise hold for review.
- A domain event `price_research.completed` (with outcome) through the existing event publisher after
  the re-estimate.

**Deferred:** scheduler for stale ladders, seller cancel, push (SSE/WebSocket), per-tier re-run,
fair scheduling across workspaces, a separate worker process, concurrency above 3.

## Answers to the builder check (designer's calls)

- Item class unknown (identify finds no class attributes): substitutes are kept, marked
  "class unchecked", and feed neither the substitute ceiling nor tier confidence; the estimate is low
  confidence instead of empty.
- Class attributes live inside each `PriceComparable` in the existing JSON column; no migration for
  them. Old automatic rows are replaced on the next run (manual rows are never touched).
- The `.pl` host rule applies only to `last_new_price` and `substitute_new`; same-model and used
  rows still need an OLX advert or Allegro Lokalnie offer URL. URL validation becomes tier-aware.
- A wrong too-high `last_new_price` cannot raise the ceiling (the lowest cap wins); the outlier
  check guards against a wrong too-low one: with no kept new substitutes it compares with the median
  of all other kept rows.
- The toolset check runs before every Hermes call in the graph.

## Non-goals

- Price discovery over time (part C).
- Writing completeness into the OLX advert text or drafts.
- Server-side re-fetch of pages; markets other than PLN / Poland.
- Changing the ceiling (70 %) or confidence rules.

## Anti-goals

- Seller free text (description, `missingAccessories`) reaching the web-enabled profile.
- A substitute of another class reaching the estimate (the BenQ case).
- A price the agent did not open and see; a non-PLN price stored as PLN.
- Research becoming so slow that Analyze times out at the proxy.

## Constraints

- Research profile toolset must be exactly `web`, checked before every Hermes call in the graph.
- AI usage accounted per call under feature `research`, operation per node.
- Migrations replay on every start (`ADD COLUMN IF NOT EXISTS`).
- Tests: pure functions in Jest without mocks; behaviour in q4j on an isolated stand (no research
  profile there); real research checked by hand on prod with the QH11 case as the reference
  (expected: substitutes of the 720p / ~200 ANSI class, ceiling roughly 150–240 zł).

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| 1 | Better prompt in the single call | cheapest; spike shows correct class but unstable prices and no code check between steps | Rejected |
| 2 | Graph: identify → per-tier nodes → code filters | 5 Hermes calls, more code; narrow tasks and code checks between nodes | **Chosen** |
| 3 | Two calls (identify, then all tiers) | spike B: the second call found no substitutes | Rejected |

## Decided by the owner

- Graph (approach 2); Hermes + LangGraph as the core of the app.
- Completeness for pricing only.
- Any `.pl` shop host in addition to the allowlist, with a denylist of non-shops.
- Execution model decided by an arena the owner asked for (background job; see Execution).

## Designer's calls (correctable)

- Class attributes are generic `{name, value, match}` so the graph is not tied to projectors.
- `ratio` tolerance ×0.5–×2; missing attribute → drop.
- New items from private OLX sellers count as `substitute_new`.
- `last_new_price` outlier rule: > 3× the median of kept new substitutes → drop.
- Budgets and concurrency: see Execution (180 s per node, 7 min per run, limiter of 3).

## Left to the builder

- Exact zod schemas per node and how class attributes are stored on rows (e.g. inside
  `PriceComparable`).
- The denylist contents and how a host is classified as non-shop.
- How graph transitions are logged and surfaced (follow `AssistanceTransition`).
- Copy for the class line in the seller view.
