# Listing Response Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the seller, per live OLX listing, whether silence is still normal, and when it is not, measure where the advert stands in OLX search and what to change.

**Architecture:** A pure funnel-stage rule computed on read next to the catalogue statistics, and an on-demand LangGraph graph (`ListingResponseGraph`) that reuses the stored sale verdict and, for `not_seen` listings only, probes OLX search through the web-enabled Hermes research profile. Runs are stored and queued in the `SaleVerdictRuns` / `SaleVerdictHandler` pattern.

**Tech Stack:** TypeScript, `@langchain/langgraph`, zod, Postgres, BullMQ queue wrapper (`IJobQueue`), React + RTK Query, q4j (`test-automation`, Java 21).

**Spec:** `docs/superpowers/specs/2026-11-23-listing-response-graph-design.md`

## Global Constraints

- Seller free text never reaches the research profile; prompts are built only from `researchItemFromProduct` fields.
- No Hermes free text in graph state, the database or logs. The only Hermes-derived strings kept are buyer queries that pass `isSafeQuery` (Task 3). Competitor titles are never requested or stored. Logs carry ids and codes.
- MarketDesk never fetches OLX search itself; every search goes through `ComparableResearchProfile` behind the shared `ResearchCallLimiter` and the `isResearchToolsetSafe` guard.
- Migrations replay on every start: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, never a DROP.
- The graph creates no `HermesEvent`s and applies nothing.
- Graph version constant: `listing-response@1`. AI usage feature: `response`.
- Thresholds (exported constants, exact values): `YOUNG_MS = 48 h`, `NOT_SEEN_MAX_VIEWS = 30`, `NOT_SEEN_MAX_VIEWS_PER_DAY = 3`, `ENOUGH_VIEWS = 80`, `STALE_AFTER_MS` (existing), `REUSE_WINDOW_MS = 6 h`, `DEEP_POSITION = 20`, `CROWDED_TOTAL = 500`.
- Jest locally: `SKIP_REDIS_TESTS=true npx jest <path> --forceExit`. `npm run type-check` skips `*.test.*`.
- q4j runs need `JAVA_HOME` set to JDK 21.
- Branch: implementation goes on a new `feat/listing-response-graph` branch from `main`, not on this docs branch.

## Review Focus

1. The advert's own URL appears in results in another form (query string, `m.olx.pl`, different slug case) → it must still be located. Pinned in Task 2 (`locateOwn`).
2. Query words with Polish diacritics or other case than the title (`słuchawki` vs `Sluchawki`) → not reported as missing. Pinned in Task 2 (`missingQueryWords`).
3. Statistics unavailable (views null, or thread metrics null with watchers null) on an old listing → `no_data`, never `not_seen`. Pinned in Task 1.
4. A result card with no usable PLN price ("Zamienię", "Za darmo", EUR) → the card is kept for position and skipped for price comparison; the probe does not fail. Pinned in Tasks 2 and 3.
5. The probe returns zero results, only the own advert, or `total: null` → no crash, no `price_high_among_top`, `not_in_results` only when at least one other card was returned. Pinned in Task 2.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/types/index.ts` (modify) | `ResponseStage`, `ListingResponseSignal`, `ResponseFinding`, `ResponseProbe`, `ListingResponseRun`, `ListingResponseView`; `ProductStats.response` |
| `src/backend/application/services/productStats.ts` (modify) | `listingResponseSignal` pure rule |
| `src/backend/application/services/ProductStatsService.ts` (modify) | fills `ProductStats.response` |
| `src/backend/domain/services/listingResponseRules.ts` (create) | `knownFindings`, `locateOwn`, `missingQueryWords`, `probeFindings`, `rankFindings`, `subjectFingerprint` |
| `src/backend/infrastructure/external/listingResponsePrompts.ts` (create) | query and probe prompts, zod parsers, `isSafeQuery` |
| `src/backend/persistence/migrations/056_listing_response_runs.sql` (create) | table and indexes |
| `src/backend/domain/repositories/interfaces/IListingResponseRunRepository.ts` (create) | repository contract |
| `src/backend/infrastructure/persistence/repositories/ListingResponseRunRepository.ts` (create) | Postgres implementation |
| `src/backend/application/services/response/ListingResponseGraph.ts` (create) | the graph |
| `src/backend/application/services/response/ListingResponseRuns.ts` (create) | request, reuse, view, expiry |
| `src/backend/infrastructure/jobQueue/JobHandlers/ListingResponseHandler.ts` (create) | job handler |
| `src/backend/application/ports/IJobQueue.ts`, `config/di/container.ts`, `presentation/http/{app.ts,routes/hermes.ts,controllers/HermesController.ts,controllers/ProductController.ts}` (modify) | wiring and endpoints |
| `src/frontend/state/api/hermesApi.ts`, `components/products/ResponseSummary.tsx` + `responseDisplay.ts` (create), `components/tables/ProductsTable.tsx`, `components/product-detail/hermes/{HermesCard.tsx,hermesCardModel.ts}` (modify) | UI |
| `test-automation/.../{service/ResponseService,step/ResponseSteps,verification/ResponseVerification,model/ListingResponsePojo}.java`, `test/api/ListingResponseTest.java`, `test/ui/ListingResponseUiTest.java` (create) | live tests |

---

### Task 0: Spike — can the research profile return an ordered OLX results page?

Throwaway. No product code, nothing committed except the note in Step 3.

- [ ] **Step 1:** In the scratchpad, write a script that calls the `marketdesk-research` profile (same endpoint and auth the app uses; read them from the deploy env, never print them) with one prompt per phrase, for the three live listings (`airpods 4`, `projektor led hdmi`, `frezarka do paznokci`). The prompt: open `https://www.olx.pl/oferty/q-<phrase>/`, return JSON `{ "total": number|null, "results": [{ "url": string, "price": string|null, "promoted": boolean }] }` in page order, no other text.
- [ ] **Step 2:** For each phrase run it twice. Record: did the JSON parse; how many results came back; is the order stable between the two runs; does it match the page opened by hand in a browser (first 10 URLs); is `promoted` right for the cards marked "Wyróżnione"; seconds and tokens per call.
- [ ] **Step 3:** Write the outcome into the spec under "Open risk" as a dated "Spike result" paragraph: the reliable N, whether `promoted` is usable, cost per call. Commit `docs: record the search probe spike result`.
- [ ] **Step 4: Gate.** If order is not stable or does not match the page for at least 2 of 3 phrases, STOP and report to the owner; do not start Task 1. If `promoted` is unreliable, continue with `promoted` always `false` and position counted among all cards (spec allows it); record that.

**Produces:** `PROBE_RESULTS` (N), and the final wording of the probe prompt for Task 3.

---

### Task 1: Funnel stage in catalogue statistics

**Files:**
- Modify: `src/shared/types/index.ts`, `src/backend/application/services/productStats.ts`, `src/backend/application/services/ProductStatsService.ts`
- Test: `src/backend/application/services/__tests__/productStats.test.ts`, the existing `ProductStatsService` test file

**Interfaces — Produces:**

```ts
// shared/types
export type ResponseStage = 'no_data' | 'responding' | 'too_early' | 'not_seen' | 'seen_not_contacted';
export interface ListingResponseSignal {
  listingId: string;
  stage: ResponseStage;
  views: number | null;
  viewsPerDay: number | null;   // mean of the last three complete UTC days
  hoursLive: number | null;
  viewsNeeded: number | null;   // ENOUGH_VIEWS while collecting, else null
}
// ProductStats gains:  response: ListingResponseSignal | null;

// productStats.ts
export interface ResponseListing extends StatsListing { id: string; conversations: number | null }
export function listingResponseSignal(listing: ResponseListing, views: ListingViews | undefined, now: Date): ListingResponseSignal;
```

`ProductStatsService` picks the product's first listing with status `live` and sets `response` from it; no live listing → `response: null`.

- [ ] **Step 1: Write failing tests** in `productStats.test.ts`, `describe('listingResponseSignal')`, one test per row, `now = 2026-11-23T12:00:00Z`, a `listing()` builder defaulting to live, published 96 h ago, synced 1 h ago, views 17, watchers 0, conversations 0, `byDay` ending `[…, 1, 0, 1, 5]` (last bucket = today, ignored):

| Test | Input change | Expect `stage` (and) |
|---|---|---|
| stale statistics | `lastSyncAt` 25 h ago, watchers 2 | `no_data` |
| views unavailable | `views: null` | `no_data` |
| both contact metrics unknown | `watchers: null, conversations: null` | `no_data` |
| a watcher | `watchers: 1` | `responding` |
| conversations unknown, watchers known | `conversations: null, watchers: 0` | not `no_data` (falls through to `not_seen`) |
| young | published 47 h ago | `too_early`, `viewsNeeded: null` |
| not seen | default | `not_seen`, `viewsPerDay` ≈ 0.67 |
| few views but growing | `byDay` last three complete days `[4, 5, 6]` | `too_early`, `viewsNeeded: 80` |
| collecting | views 45 | `too_early`, `viewsNeeded: 80` |
| enough views, no contact | views 80 | `seen_not_contacted` |
| not live | `status: 'expired'` | `no_data` |
| no publishedAt | `publishedAt: null`, views 17 | `no_data` |

- [ ] **Step 2:** Run `SKIP_REDIS_TESTS=true npx jest src/backend/application/services/__tests__/productStats.test.ts --forceExit`. Expected: FAIL, `listingResponseSignal` is not exported.
- [ ] **Step 3:** Implement `listingResponseSignal`, first match wins in the order `no_data`, `responding`, `too_early` (young), `not_seen`, `seen_not_contacted`, `too_early` (collecting). `viewsPerDay` = mean of `byDay[STATS_DAYS-4 .. STATS_DAYS-2]`; `views` undefined (no events) counts as zeros.
- [ ] **Step 4:** Add `conversations` and `id` to what `statsListing` maps; set `response` in `statsByProduct`; add one service test: a product with an expired and a live listing gets the live listing's `listingId`; a product with no live listing gets `response: null`. Update the fallback object.
- [ ] **Step 5:** Run both test files and `npm run type-check`. Expected: PASS (fix frontend fixtures that build `ProductStats`).
- [ ] **Step 6:** Commit `feat(stats): response stage per live listing`.

---

### Task 2: Pure finding rules

**Files:**
- Create: `src/backend/domain/services/listingResponseRules.ts`
- Modify: `src/shared/types/index.ts`
- Test: `src/backend/domain/services/__tests__/listingResponseRules.test.ts`

**Interfaces — Produces:**

```ts
// shared/types
export type ResponseFindingCode =
  | 'verdict_reason' | 'no_verdict' | 'verdict_out_of_date'
  | 'not_in_results' | 'deep_in_results' | 'title_misses_query_words'
  | 'price_high_among_top' | 'crowded_market' | 'probe_failed';
export type ResponseAction = 'open_proposal' | 'run_analyze' | 'edit_title' | 'review_price' | 'refresh_advert' | 'retry' | null;
export interface ResponseFinding {
  code: ResponseFindingCode;
  message: string;                 // fixed copy built in code from the evidence
  action: ResponseAction;
  evidence: {
    query?: string; position?: number; checked?: number; total?: number | null;
    missingWords?: string[]; ownPrice?: number; lowPrice?: number; highPrice?: number;
    verdictCheck?: VerdictCheckName; verdictReasonCode?: string; eventIds?: string[];
  };
}
export interface ProbeCard { url: string; price: number | null; promoted: boolean }
export interface ResponseProbe { query: string; status: 'ok' | 'failed'; total: number | null; cards: ProbeCard[] }

// listingResponseRules.ts
export function knownFindings(verdict: SaleVerdict | null, changedAt: Date): ResponseFinding[];
export function locateOwn(cards: ProbeCard[], ownUrl: string): { position: number | null; organicAbove: ProbeCard[] };
export function missingQueryWords(query: string, title: string): string[];
export function probeFindings(probe: ResponseProbe, own: { url: string; title: string; price: number }): ResponseFinding[];
export function rankFindings(findings: ResponseFinding[]): ResponseFinding[];
export function subjectFingerprint(input: { title: string; price: number; categoryId: string | null }): string;
```

Decisions the tests pin:
- `knownFindings`: no verdict → one `no_verdict` (`run_analyze`). Each reason of each `fix` or `needs_human` check → one `verdict_reason` with the reason's message unchanged, `verdictCheck`, `verdictReasonCode`, `eventIds`; action `open_proposal` when `eventIds` is non-empty, else `run_analyze`. `changedAt` later than `verdict.completedAt` → additionally `verdict_out_of_date`. `changedAt` is the later of product `updatedAt` and the moment the subject fingerprint changed; the caller passes product `updatedAt`.
- `locateOwn`: match by the advert key used in `excludedAdvertKeys` (`infrastructure/external/anchorLadderPrompt.ts`; export its key function and move it to the domain rule if the import direction forbids it). Position is 1-based among non-promoted cards; the own card is never counted as above itself.
- `missingQueryWords`: lower-case, strip diacritics (NFD + `ł→l`), words of 3+ characters, absent from the title as whole-word prefixes.
- `probeFindings` for an `ok` probe: own not found and at least one other card → `not_in_results` (`edit_title`); found with position > `DEEP_POSITION` → `deep_in_results` (`refresh_advert`); missing words non-empty → `title_misses_query_words` (`edit_title`); at least 3 priced organic cards above and own price above their median → `price_high_among_top` (`review_price`) with `lowPrice`/`highPrice`; `total > CROWDED_TOTAL` → `crowded_market` (action null). A `failed` probe → nothing here.
- `rankFindings` order: `verdict_reason`, `not_in_results`, `deep_in_results`, `price_high_among_top`, `title_misses_query_words`, `verdict_out_of_date`, `no_verdict`, `crowded_market`, `probe_failed`; same code and same evidence deduplicated; `title_misses_query_words` across queries merged into one finding with the union of words.

- [ ] **Step 1: Write failing tests**, one per decision above plus the Review Focus cases:
  - `locateOwn` finds `https://www.olx.pl/d/oferta/apple-airpods-4-CID99-ID1aBcD.html` when the card URL is `https://m.olx.pl/d/oferta/apple-airpods-4-CID99-ID1aBcD.html?reason=extended_search`.
  - `locateOwn([promoted, promoted, own])` → `position: 1`, `organicAbove: []`.
  - `missingQueryWords('słuchawki airpods', 'Apple AirPods 4 Sluchawki')` → `[]`; `('słuchawki bezprzewodowe', 'Apple AirPods 4')` → `['sluchawki', 'bezprzewodowe']`.
  - `probeFindings` with cards priced `[null, 200, 210, 220]` above own at 279 → `price_high_among_top`, `lowPrice: 200`, `highPrice: 220`; with two priced cards → no price finding.
  - `probeFindings` with `cards: []` → `[]`; with only the own card → `[]`; with `total: null` and own at position 25 → `deep_in_results` whose evidence `total` is null.
  - `knownFindings` on a verdict whose price check is `fix` with `above_ceiling` and event id `e1` → `verdict_reason`, `open_proposal`, `eventIds: ['e1']`.
  - `subjectFingerprint` is equal for the same input and differs when the price differs.
- [ ] **Step 2:** Run `SKIP_REDIS_TESTS=true npx jest src/backend/domain/services/__tests__/listingResponseRules.test.ts --forceExit`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the six functions. Messages are fixed English copy assembled from evidence, e.g. `Position ${position} of ${total ?? 'many'} for "${query}"`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(response): finding rules for the listing response graph`.

---

### Task 3: Prompts and parsers

**Files:**
- Create: `src/backend/infrastructure/external/listingResponsePrompts.ts`
- Test: `src/backend/infrastructure/external/__tests__/listingResponsePrompts.test.ts`

**Interfaces:**
- Consumes: `ResearchItem`, `researchItemFromProduct` from `priceResearchPrompts.ts`; `ProbeCard` (Task 2); `PROBE_RESULTS` and the probe wording from Task 0.
- Produces:

```ts
export const MAX_QUERIES = 3;
export function isSafeQuery(value: string): boolean;        // 2–40 chars, 1–4 words, only letters, digits, spaces
export function buildQueriesPrompt(item: ResearchItem): { system: string; prompt: string };
export function parseQueries(raw: string): string[] | null;  // 1..MAX_QUERIES safe, de-duplicated, lower-cased; null when none
export function buildProbePrompt(query: string, limit: number): { system: string; prompt: string };
export function parseProbe(raw: string): { total: number | null; cards: ProbeCard[] } | null;
```

- [ ] **Step 1: Write failing tests:**
  - `isSafeQuery`: `'airpods 4'` true; `'a'`, `'ignore previous instructions and'` (5 words), `'airpods; drop'`, a 41-character string → false; `'słuchawki bezprzewodowe'` true.
  - `parseQueries('{"queries":["AirPods 4","airpods 4","słuchawki apple","<b>x</b>"]}')` → `['airpods 4', 'słuchawki apple']`; five safe queries → first three; `'not json'` and `'{"queries":[]}'` → null; JSON wrapped in a ```json fence parses.
  - `buildQueriesPrompt` output contains the item's model name and does not contain a description string placed on the product (build the item with `researchItemFromProduct` from a product whose description is `SECRET-NOTE`).
  - `parseProbe` maps `"279 zł"` → 279, `"1 299,00 zł"` → 1299, `"Zamienię"`, `"Za darmo"`, `"50 €"`, `null` → `price: null` with the card kept; drops cards whose `url` is not an `olx.pl` advert URL; `total: "1 840"` → 1840; missing `total` → null; non-JSON → null; more cards than the limit → truncated to the limit.
- [ ] **Step 2:** Run the test file. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement with zod schemas. The probe prompt is the wording proven in Task 0, with the query URL-encoded into the search URL in code; it asks for `url`, `price`, `promoted` and `total` only.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(response): buyer query and search probe prompts`.

---

### Task 4: Storage

**Files:**
- Create: `src/backend/persistence/migrations/056_listing_response_runs.sql`, `src/backend/domain/repositories/interfaces/IListingResponseRunRepository.ts`, `src/backend/infrastructure/persistence/repositories/ListingResponseRunRepository.ts`
- Modify: `src/shared/types/index.ts`
- Test: `src/backend/infrastructure/persistence/repositories/__tests__/ListingResponseRunRepository.integration.test.ts` (same guarded TEMP-table setup as `SaleVerdictRepository.integration.test.ts`)

**Interfaces — Produces:**

```ts
// shared/types
export interface ListingResponseRun {
  id: string; productId: string; listingId: string; graphVersion: string;
  status: VerdictRunStatus;
  stage: ResponseStage | null; signal: ListingResponseSignal | null;
  probes: Array<Omit<ResponseProbe, 'cards'> & { position: number | null; checked: number }>;
  findings: ResponseFinding[];
  fingerprint: string; errorCode: string | null; createdAt: string; completedAt: string | null;
}
export interface ListingResponseView {
  latest: ListingResponseRun | null; active: ListingResponseRun | null;
  lastFailed: boolean; outOfDate: boolean;
}

// IListingResponseRunRepository
insertQueued(run: { id; workspaceId; productId; listingId; graphVersion; fingerprint; queuedAt: string }): Promise<ListingResponseRun | null>; // null when the listing has an active run
findActive(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
claim(runId: string, startedAt: string, leaseUntil: string): Promise<ListingResponseRun | null>;
complete(runId: string, fields: Pick<ListingResponseRun, 'stage' | 'signal' | 'probes' | 'findings'> & { completedAt: string }): Promise<boolean>;
fail(runId: string, completedAt: string, errorCode: string): Promise<boolean>;
failExpired(workspaceId: string, listingId: string, now: string, queuedBefore: string, errorCode: string): Promise<boolean>;
findById(workspaceId: string, runId: string): Promise<ListingResponseRun | null>;
findLatestCompleted(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
findNewest(workspaceId: string, listingId: string): Promise<ListingResponseRun | null>;
findLatestCompletedForProducts(workspaceId: string, productIds: string[]): Promise<Map<string, ListingResponseRun>>;
```

Table `listing_response_runs`: the columns of `product_sale_verdicts` minus `scope`, `overall`, `checks`, plus `listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE`, `stage VARCHAR(30)`, `signal JSONB`, `probes JSONB NOT NULL DEFAULT '[]'`, `findings JSONB NOT NULL DEFAULT '[]'`, `fingerprint VARCHAR(64) NOT NULL`. Unique partial index on `(listing_id) WHERE status IN ('queued','running')`; index on `(workspace_id, listing_id, completed_at DESC) WHERE status = 'completed'`. Stored probes hold no card lists.

- [ ] **Step 1: Write failing integration tests:** second `insertQueued` for the same listing → null; `claim` moves queued → running once, second call → null; `complete` then `findLatestCompleted` returns the stored `findings` and `probes` deep-equal; `complete` on a failed run → false; `failExpired` fails a running run past its lease and a queued run older than `queuedBefore`; `findLatestCompletedForProducts` returns the newest completed per product and nothing for a product with only a failed run; rows of another workspace are not returned.
- [ ] **Step 2:** Run the test file. Expected: FAIL, module not found.
- [ ] **Step 3:** Write the migration and the repository, parameterized queries only, mirroring `SaleVerdictRepository`.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(response): listing response run storage`.

---

### Task 5: The graph

**Files:**
- Create: `src/backend/application/services/response/ListingResponseGraph.ts`
- Test: `src/backend/application/services/response/__tests__/ListingResponseGraph.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `ComparableResearchProfile`, `ResearchCallLimiter`, `isResearchToolsetSafe`, `withAiUsageScope`, `withAiOperation`, `AITextCompletionClient`.
- Produces:

```ts
export const LISTING_RESPONSE_GRAPH_VERSION = 'listing-response@1';
export interface ResponseTransition { node: 'load' | 'known' | 'route' | 'queries' | 'probe' | 'locate' | 'compare' | 'rank' | 'save'; phase: 'started' | 'completed' | 'failed' }
export interface ListingResponseGraphDeps {
  products: Pick<IProductRepository, 'findByIdForWorkspace'>;
  listings: Pick<IListingRepository, 'findByProduct'>;
  marketplaces: Pick<IMarketplaceRepository, 'findByIdForWorkspace'>;
  analytics: Pick<IAnalyticsEventRepository, 'findByRange'>;
  verdicts: Pick<ISaleVerdictRepository, 'findLatestCompleted'>;
  runs: Pick<IListingResponseRunRepository, 'complete' | 'findById'>;
  queryClient: AITextCompletionClient | null;      // no-tools marketplace profile
  profile: ComparableResearchProfile | null;       // web research profile
  limiter: ResearchCallLimiter;
  probeResults: number;
  now: () => Date;
  observe?: (t: ResponseTransition) => void;
  logger?: { warn(context: Record<string, unknown>, message: string): void };
}
export class ListingResponseGraph {
  run(input: { workspaceId: string; productId: string; runId: string; signal: AbortSignal }): Promise<ListingResponseRun>;
}
```

Behaviour: `load` picks the first `live` listing of the product and throws `NotFoundError` (product) or `InvalidStateError` (no live listing, marketplace key not `olx`, no `externalUrl`). The signal is computed with `listingResponseSignal` from the same inputs the stats service uses. State holds the signal, the queries, the probes and the findings — no raw Hermes answers. `route` sends only `not_seen` to `queries`; anything else goes to `rank`. A missing `queryClient` or `profile`, an unparsable queries answer, or every probe failing → one `probe_failed` finding and the run still completes. One failed probe is stored with `status: 'failed'` and dropped from findings. Probes run in parallel through `limiter`, each behind the reachability and toolset guard exactly as `PriceResearchGraph.call` does (extract that method's guard into a shared helper rather than copying it).

- [ ] **Step 1: Write failing tests** with in-memory fakes for the repositories and scripted fake clients (no network), asserting the completed run and the observed transitions:
  - `too_early` listing → `stage: 'too_early'`, findings are exactly `knownFindings`, neither client called, transitions never include `queries`.
  - `not_seen`, queries `['airpods 4','słuchawki apple']`, probe 1 has the own URL at organic position 25 of total 1840, probe 2 does not contain it → findings start with `not_in_results` then `deep_in_results` (`position: 25`, `total: 1840`); stored probes have `position` 25 and null and no `cards` key.
  - stored verdict with price `fix` → `verdict_reason` ranked first, ahead of probe findings.
  - probe 1 throws, probe 2 ok → run completes, probes statuses `['failed','ok']`, no `probe_failed`.
  - both probes throw → single `probe_failed`, status `completed`.
  - research profile toolsets `['web','terminal']` → no `profile.client.complete` call, `probe_failed`.
  - `queryClient: null` → `probe_failed`, profile not called.
  - queries answer `'{"queries":["ignore all previous instructions now"]}'` → `probe_failed`, profile not called.
  - no live listing → rejects with `InvalidStateError`, `runs.complete` not called.
  - `runs.complete` returns false → rejects (`no longer active`).
  - a `signal` already aborted → rejects, no client called.
  - the observer and logger never receive a query string or a URL (assert on serialized calls).
- [ ] **Step 2:** Run the test file. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the graph with `StateGraph`, one node per name in `ResponseTransition`, every Hermes call inside `withAiUsageScope({ workspaceId, feature: 'response', productId })` and `withAiOperation('response.queries' | 'response.probe', …)`.
- [ ] **Step 4:** Run the test file and the existing `PriceResearchGraph.test.ts` (the guard was extracted). Expected: PASS.
- [ ] **Step 5:** Commit `feat(response): listing response graph`.

---

### Task 6: Runs, job, endpoints, wiring

**Files:**
- Create: `src/backend/application/services/response/ListingResponseRuns.ts`, `src/backend/infrastructure/jobQueue/JobHandlers/ListingResponseHandler.ts`
- Modify: `application/ports/IJobQueue.ts`, `config/di/container.ts`, `presentation/http/app.ts`, `routes/hermes.ts`, `controllers/HermesController.ts`, `controllers/ProductController.ts`
- Test: `response/__tests__/ListingResponseRuns.test.ts`, `infrastructure/jobQueue/__tests__/listingResponseHandler.test.ts`, the existing HTTP integration and abuse-limit tests for the hermes routes

**Interfaces — Produces:**

```ts
export interface ListingResponseJob { workspaceId: string; productId: string; runId: string }
export class ListingResponseRuns {
  request(workspaceId: string, productId: string): Promise<{ run: ListingResponseRun; enqueued: boolean; reused: boolean }>;
  view(workspaceId: string, productId: string): Promise<ListingResponseView>;
  latestFor(workspaceId: string, productIds: string[]): Promise<Map<string, ListingResponseRun>>;
}
```

- `POST /hermes/products/:productId/response-run` → `{ run, reused }` (202 when enqueued, 200 when reused or already active). Mounted with the same rate limiter and at the same install site as `POST /hermes/products/:productId/run`.
- `GET /hermes/products/:productId/response` → `ListingResponseView`.
- The catalogue list response carries each product's latest completed response run next to its verdict (where `saleVerdictRuns.viewsFor` is joined today), field `response`.
- Queue name `listing-response`; handler lease 5 min, run budget 4 min; a throw fails the run with `run_error`; `InvalidStateError` from `load` fails it with `not_applicable`.
- `request`: product not found → `NotFoundError`; no live OLX listing → `InvalidStateError`; expire stuck runs (queued TTL = `VERDICT_QUEUED_TTL_MS`); a completed run younger than `REUSE_WINDOW_MS` with the same `subjectFingerprint` (listing title, listing price, category id) → returned with `reused: true`; an active run → returned with `enqueued: false`; enqueue failure → run failed with `enqueue_failed`, error rethrown.
- `view.outOfDate`: latest completed run's fingerprint differs from the current one.
- Container: `queryClient` is the existing main-profile `HermesCompletionClient`; `profile` and `limiter` are the same instances `PriceResearchGraph` gets (hoist them into constants); `probeResults` from Task 0.

- [ ] **Step 1: Write failing tests** for `ListingResponseRuns` with fakes: reuse within 6 h and same fingerprint (no enqueue); no reuse after 6 h 1 min; no reuse when the listing price changed; second request while active → same run id, `enqueued: false`; queue throws → run failed `enqueue_failed` and the error propagates; `view` reports `lastFailed` when the newest run failed and still returns the older `latest`; `view.outOfDate` true after a price change. Handler tests: a run no longer queued → `skipped`; graph throws → failed `run_error`; `InvalidStateError` → failed `not_applicable`.
- [ ] **Step 2:** Run both test files. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement the service, the handler, the job type, the controller methods, the routes and the container wiring (queue registered and added to the managed queues list like `saleVerdictQueue`).
- [ ] **Step 4:** Extend the hermes routes integration test: POST for an unknown product → 404; for a product of another workspace → 404; unauthenticated → 401; POST twice → same run id. Extend the abuse-limit test with the new POST.
- [ ] **Step 5:** Run the new files, the two extended files, `npm run type-check`, `npm run lint`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(response): response runs, job and endpoints`.

---

### Task 7: UI

**Files:**
- Create: `src/frontend/components/products/responseDisplay.ts`, `src/frontend/components/products/ResponseSummary.tsx`, `src/frontend/components/products/__tests__/responseDisplay.test.ts`
- Modify: `src/frontend/state/api/hermesApi.ts` (+ its test), `src/frontend/components/tables/ProductsTable.tsx` (+ test), `src/frontend/components/product-detail/hermes/hermesCardModel.ts` (+ test), `HermesCard.tsx`

**Interfaces — Produces:**

```ts
// responseDisplay.ts — pure
export function stageLabel(signal: ListingResponseSignal): string;
export function responseLines(run: ListingResponseRun | null, limit: number): string[];
export function canAskWhy(signal: ListingResponseSignal | null, active: boolean): boolean;
// hermesApi: useRequestResponseRunMutation, useGetResponseViewQuery (polls while view.active)
```

Exact copy: `too_early` young → `Too early · day ${ceil(hoursLive/24)}`; collecting → `Too early · ${views} of ${viewsNeeded} views`; `not_seen` → `Not seen · day ${ceil(hoursLive/24)}`; `seen_not_contacted` → `Seen, no contact · ${views} views`; `responding` → no line; `no_data` → `No fresh statistics`. Button label `Why no response?`, shown for `not_seen` and `seen_not_contacted`, disabled while a run is active (label `Checking…`). After a run the row shows `checked ${relative time}` and the first two `responseLines`; the Hermes card shows all of them, each with its action as a link or button to the existing control (Analyze, Review price, edit form, proposal). An out-of-date result is marked `out of date`.

- [ ] **Step 1: Write failing tests** for `responseDisplay.ts`: each label above with the exact string; `canAskWhy` false for `too_early`, `responding`, `no_data`, null, and while active; `responseLines` returns finding messages in stored order, capped at the limit, `[]` for null. Add a `renderToStaticMarkup` test to `ProductsTable.test.tsx`: a `not_seen` product renders `Not seen · day 4` and the button; a `responding` product renders neither. Add a `hermesApi` test for the two endpoints' URLs and methods.
- [ ] **Step 2:** Run the frontend test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Read `currentData`, not `data`, where the query argument changes (product page navigation).
- [ ] **Step 4:** Run the test files, `npm run type-check`, `npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(products): response stage and "Why no response?" in the catalogue and the Hermes card`.

---

### Task 8: Live tests on a branch stand

**Files:**
- Create: `test-automation/src/main/java/dev/quokkify/marketdesk/{model/ListingResponsePojo,service/ResponseService,step/ResponseSteps,verification/ResponseVerification}.java`, `test-automation/src/test/java/dev/quokkify/marketdesk/test/api/ListingResponseTest.java`, `test/ui/ListingResponseUiTest.java`
- Modify: `HermesMockSteps` / `HermesMockService` (expectations for the queries call and the probe calls), `ProductStatsTest` (the new `response` field)

Follow `SaleVerdictTest`, `PriceResearchRunTest` and `SaleVerdictUiTest` for structure, and the isolated Compose stand with the Hermes mock for both profiles.

- [ ] **Step 1:** Write `ListingResponseTest`:
  - `tooEarlyListingAnswersWithoutSearching` — a freshly published listing; POST response-run; poll the view to `completed`; stage `too_early`; the mock received no call on the research profile.
  - `notSeenListingReportsItsSearchPosition` — a listing seeded as live for 72 h with 10 views (seed through the OLX stub the stand uses; if `published_at` cannot be set through any existing test seam, add a test-only seam in the stub, not in production code paths); mock queries → `["test item"]`, mock probe → 30 organic cards with the listing's own URL 25th, total 1840; expect a `deep_in_results` finding with position 25 and total 1840.
  - `failedSearchIsReportedAsNotChecked` — mock probe answers 500; run `completed`, a single `probe_failed` finding.
  - `secondRequestReturnsTheSameRun` — two POSTs; same run id, second `reused` or not enqueued.
  - `responseRunOfAnotherWorkspaceIsNotFound` — 404.
- [ ] **Step 2:** Write `ListingResponseUiTest`: the `not_seen` product's row shows `Not seen`, clicking `Why no response?` ends with the position line in the row and in the Hermes card.
- [ ] **Step 3:** Run the two classes on the stand with `JAVA_HOME` on JDK 21. Expected: PASS. Review the Allure evidence per the project's allure-agent-mode skill.
- [ ] **Step 4:** Commit `test(response): live tests for the listing response graph`.

---

### Task 9: Real-OLX check and docs

- [ ] **Step 1:** On a stand pointed at the real research profile, run "Why no response?" for the three live listings. Compare each reported position with the OLX page opened by hand. Record the three results in the PR description. A mismatch on more than one listing is a blocker: stop and report.
- [ ] **Step 2:** Add the graph to `docs/graph-testing-plan.md`'s list of graphs and add a short "Listing response" section to the user-facing docs where the sale verdict is described.
- [ ] **Step 3:** Commit `docs: listing response graph`.
