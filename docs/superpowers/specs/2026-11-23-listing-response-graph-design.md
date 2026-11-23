# Listing response graph — design

Date: 2026-11-23. Status: draft for owner approval.

## Intent

A product is live on OLX and nobody writes. The owner wants a graph that works out what may be
wrong. Today the owner's only move in the first days is to wait and do nothing, and that choice is
made by eye.

The graph answers two questions, in this order:

1. Is it time to act, or is waiting still right — and why?
2. If it is time: where does the buyer drop off, with evidence, and what to change?

Observed on 2026-11-23 (owner's catalogue): three live listings, 9, 14 and 17 views, 7-day growth
0 to +2, 0 watchers, 0 messages. One of them (250 zł against a fair ceiling of 169 zł) is live
with a "Not ready" verdict.

## Goals

- A cheap, always-on answer per live listing: `too_early`, `not_seen`, `seen_not_contacted`,
  `responding` or `no_data`, with the numbers behind it.
- For `not_seen`: a search probe that measures where the advert stands in OLX search for buyer
  queries and how its card (title, price) compares with the cards above it.
- Findings ranked as cause → evidence → action. A finding without evidence is not shown.
- Reuse what the system already knows: the stored sale verdict is the first source of findings.

## Non-goals

- Applying anything automatically, scheduled probes, experiments (one change, measure, repeat).
  Those belong to autopilot and take this graph's findings as their input.
- Judging the cover photo. It needs the vision step planned for the sale verdict (step 2 there).
- A buyer-behaviour diagnosis for `seen_not_contacted` beyond the stored verdict. No listing has
  enough views for it yet; it is the next design, not this one.
- New proposal (HermesEvent) types.

## Anti-goals

- An alarm in the first days, when silence is normal.
- A stated cause with no measurement behind it ("the title is weak") — the probe failing must read
  as "could not check", never as a guess.
- Seller free text reaching the web-enabled Hermes profile, or Hermes free text in graph state,
  storage or logs. The one exception is the buyer queries: short phrases that pass a strict shape
  check (a few words, letters and digits only). Competitor titles are neither requested nor kept.
- Loading OLX search pages without limits. Direct loading (owner's decision of 2026-11-23, see
  "Decision after the spike") is bounded: only on the button, sequential, with a pause between
  pages, a page cap per query and the 6-hour reuse window.

## Approaches considered

1. **Code only.** View thresholds plus the stored verdict. Cheap, no Hermes. For a listing whose
   verdict is "Ready to sell" it has nothing to say.
2. **Search probe on top of the code funnel** — chosen by the owner. The funnel decides in code
   whether to wait; the probe runs only when the funnel says `not_seen`. It is the only way to
   tell "not shown" from "shown but not clicked", which OLX statistics cannot separate (a view is
   a click from the results list). Cost: slow web calls, and the profile's ability to read an
   ordered OLX results page is unproven.
3. **Experiment loop.** Change one thing, measure views after N days. The only real proof of a
   cause, but it needs pauses and a checkpointer — autopilot. Slow on three listings.

## Design

### Two parts

**Funnel stage (code, no AI, no storage).** A pure function next to the catalogue statistics
(`productStats.ts`), computed on read from what sync already stores: views, 7-day view growth,
watchers, conversations, `publishedAt`, `lastSyncAt`.

| Stage | Rule (constants, Claude's starting values, to be tuned) |
|---|---|
| `no_data` | not live, or statistics older than 24 h, or views unavailable |
| `responding` | at least one conversation or watcher |
| `too_early` | live for less than 48 h |
| `not_seen` | 48 h or more, fewer than 30 views, growth under 3 views a day |
| `seen_not_contacted` | 80 views or more, no conversation, no watcher |
| `too_early` (collecting) | everything else; shows progress, e.g. "23 of 80 views" |

Enough data is measured in views, not days: 0 messages on 10 views means nothing, on 100 it is a
signal. Visibility is the exception and is judged early, because a new advert gets its best
organic exposure while it is fresh (Claude's assumption about OLX ordering, not verified).

No comparison with the seller's other listings: there are three and all are new.

**Response graph (LangGraph, run on demand).** `ListingResponseGraph`, version
`listing-response@1`, built like `SaleVerdictGraph` and `PriceResearchGraph`: zod schema per
Hermes node, transition observer, `withAiUsageScope({ feature: 'response' })`.

```
START → load → known ─→ route ─┬─ not_seen ──→ queries → probe → locate → compare ─┐
                               └─ any other stage ──────────────────────────────────┴→ rank → save → END
```

- **load** (code): product, primary OLX listing, funnel stage, latest sale verdict. Not found or
  no live OLX listing → the run fails before any call.
- **known** (code): findings the system already has — verdict checks that are `fix` (e.g. price
  above the fair ceiling), and a verdict that is out of date. No new judgement.
- **route**: only `not_seen` goes into the probe. Other stages finish with the stage and the
  known findings, so the button always answers.
- **queries** (Hermes, no-tools `marketdesk` profile, sanitized item fields only as in
  `researchItemFromProduct`): two or three short phrases a buyer would type for this item.
- **probe** (code, no AI): MarketDesk loads the public OLX search page for the phrase and reads
  the structured data embedded in it (advert id, price, promoted or organic, total, page count).
  It pages forward until the advert is found or the page cap is reached. Queries run one after
  another.
- **locate** (code): find the listing by its OLX advert id → position among organic cards across
  the pages read, or "not in the first N".
- **compare** (code): against the organic cards of the first page (what a buyer sees first):
  where the advert's price falls, and which query words its title lacks.
- **rank** (code): order findings by how directly they are measured; attach an action to each.
- **save** (code): one row per run.

One probe failing drops that query; all probes failing gives the finding `probe_failed`
("search could not be checked") and the run still completes with the known findings.

### Findings

| Code | Evidence | Action |
|---|---|---|
| `price_above_ceiling` etc. | from the stored verdict check | open the existing proposal |
| `verdict_out_of_date` | product changed after the verdict | run Analyze |
| `not_in_results` | query, total results, N checked | fix title words, check category |
| `deep_in_results` | query, position, total | refresh the advert, title words |
| `title_misses_query_words` | query, missing words | edit title (Analyze proposes one) |
| `price_high_among_top` | own price, price range of the cards above | Review price |
| `crowded_market` | total results for the query | information only |
| `probe_failed` | which queries failed | retry later |

Actions point at what exists (Analyze, Review price, the edit form, existing proposals). The
graph creates no events of its own in this version.

### Storage and running

- New table `listing_response_runs` in a new migration (`CREATE TABLE IF NOT EXISTS`; migrations
  replay on every start, never a DROP): ids, `graph_version`, `status`, `stage`, the numbers the
  stage was decided on, `probes` (jsonb: query, total, position, price range), `findings` (jsonb),
  timestamps. The latest completed row is shown.
- Own queue and handler in the `SaleVerdictRuns` pattern: one active run per listing, a stuck run
  past the TTL is treated as failed, a failed run never hides the previous completed one.
- A result is a snapshot: the UI shows its age, and marks it out of date when the listing changed
  after it.
- Trigger in this version: a button only. The funnel stage itself is always visible at no cost.

### UI

Catalogue row, under the views block (product page: same content in the Hermes card):

```
17 ▲+1   0 watching · 0 msgs
Not seen · day 4            [Why no response?]

  after a run:
Not seen · checked 5 min ago
 1. "airpods 4" — position 212 of 1 840
 2. Title lacks "słuchawki"
```

`too_early` reads "Too early · 23 of 80 views"; no button emphasis in that stage.

## Details settled after the builder check (Claude's calls)

- **Per listing, not per product.** The stage is computed for the product's primary live OLX
  listing only. `summarizeProduct` sums across all of a product's listings, so the stage needs its
  own per-listing entry point in `productStats.ts`; the product aggregate is not reused.
- **Rule order.** First match wins, in this order: `no_data`, `responding`, `too_early` (under
  48 h), `not_seen`, `seen_not_contacted`, `too_early` (collecting). A watcher on a listing with
  stale statistics is therefore `no_data`: stale numbers are not judged.
- **`no_data`.** The listing's own `lastSyncAt` is missing or older than `STALE_AFTER_MS` (the
  existing constant), or its `views` is null.
- **Growth.** "Under 3 views a day" is the mean of the last three complete UTC days of the
  listing's `viewsByDay` (sync-recorded view events only, as today). The 7-day delta is not used
  as a rate. Known limit, accepted: `lastSyncAt` advances on syncs that brought no statistics, so
  a listing with failing OLX statistics can read as no growth.
- **Responding.** `conversations > 0` or `watchers > 0` on the listing. `conversations` is a
  listing field filled by sync; the stats input (`StatsListing`) has only `messages` today and
  gets `conversations` added. Null (thread metrics unavailable) counts as zero only when watchers
  are known; both null → `no_data`.
- **Known findings.** Every check of the latest completed verdict whose status is `fix` becomes
  one finding per reason, carrying the verdict's own reason code and message unchanged, plus the
  check's event ids so the UI can open the proposal. `needs_human` checks are passed the same way.
  A "Ready to sell" verdict gives an empty list. No verdict at all → finding `no_verdict` with the
  action "run Analyze". "Out of date" (`verdict_out_of_date`) is decided by the product's `updatedAt`
  only, later than the verdict's `completed_at`: sync writes the listing's `updated_at` on every
  pass, so the listing's timestamp would mark every verdict out of date.
- **Cost and limits.** See "Decision after the spike" for the request limits. A second click while a run is active returns the active run. A completed run younger
  than 6 hours is returned instead of starting a new one unless the listing changed after it.
  "Changed" means its title, price or category differ (a stored fingerprint); `updated_at` is not
  used because every sync writes it. The same fingerprint decides "out of date" in the UI.
- **Promoted cards.** Position is counted among organic (non-promoted) cards only and the total
  is reported next to it. Promoted cards are excluded from the price comparison. Fewer than three
  priced organic cards on the first page → no `price_high_among_top` finding.
- **Scope.** Backend, the frontend API slice, the catalogue row and the product page card, and
  their tests. The AI usage feature value is added to its type if the type is closed.

## Open risk, first task of the plan

Whether the research profile can return an ordered OLX results page for a phrase was unproven,
so the plan started with a throwaway check on real OLX for the three live listings. Result and
the decision that followed are below.

### Spike result (2026-11-23)

Six calls to the research profile on production, two per phrase (`airpods 4`, `projektor led hdmi`,
`frezarka do paznokci`), each asked for the first 30 cards of the OLX search page in order; the
three pages were also fetched once by hand for comparison.

- Three of six calls answered with an empty list in 3–8 s (no page read). Cause not investigated.
- Of the three calls that read the page, two reproduced the organic order exactly (20 of 20 and 21
  of 21 cards) and one matched for the first 9 cards and then mislabelled a card. A fourth
  (second run of one phrase) returned a subsequence of the page with cards skipped.
- Promoted cards are recognisable without the model: the advert link carries
  `reason=search%7Cpromoted` or `%7Corganic`. Promoted cards rotate between page loads.
- `total` came back in one call of six. The page itself shows it, capped at 1000.
- Cost of a successful call: 38–49 s, 15–21k tokens.
- A search page holds 51 cards, about 40 of them organic, and each of these phrases has 966 to
  1000+ adverts. A listing with a handful of views is therefore almost never on the first page, so
  a first-page probe answers "not on the first page" and cannot give a position.

Gate: not passed as written. Work stopped after Task 0 for the owner's decision.

### Decision after the spike (owner, 2026-11-23)

MarketDesk loads the OLX search pages itself and pages through them. Hermes only proposes the
buyer queries (no-tools profile); the research profile is not used by this graph.

What the saved pages showed: each page embeds its data as JSON (`window.__PRERENDERED_STATE__`,
`listing.listing`): `totalElements`, `totalPages` (25 at most), and per advert a numeric `id` (the
same id MarketDesk stores as the marketplace listing id), `isPromoted`, `searchReason`, `price`
with value and currency, `lastRefreshTime`. So the advert is located by id, not by URL.

Limits (Claude's calls): at most 3 queries per run, at most 10 pages per query, one request at a
time for the whole process, 1 s between requests, no cookies, base URL from configuration. A page
that does not answer 200 or carries no embedded data fails that query's probe; nothing is guessed.

Accepted risk: this is automated reading of OLX pages. OLX terms on it were not checked, and OLX
can change the page or block the requests at any time; the probe then reports "search could not
be checked".

## Left to the builder

- Module layout, names of types and reason codes, zod schemas, timeouts and budgets (follow
  `PriceResearchGraph`).
- N (how many results per query are checked) — as many as one call returns reliably in the spike.
- Endpoint shape, following the sale verdict endpoints.
- Tests in the project's current pattern: pure rules as unit tests, the graph on a branch stand
  against the Hermes mock through `test-automation`; the real-OLX path is checked by hand.

## Decided by the owner

- The problem: a live listing with no reaction; find what may be wrong.
- Approach 2: a search probe on top of a code funnel.
- After the spike: the probe loads OLX search pages directly instead of asking Hermes.

## Claude's calls (not discussed, correct them when reading)

- A separate graph, not a new scope of the sale verdict: the verdict says "ready to sell", this
  says how a live advert behaves over time.
- The funnel thresholds and the rule "judge visibility early, everything else by view count".
- Button-only trigger; no automatic probes until autopilot.
- No new proposal types; actions link to existing ones.
- `seen_not_contacted` and the cover photo are out of this version.
