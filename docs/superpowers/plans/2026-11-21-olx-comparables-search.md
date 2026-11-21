# OLX Comparables Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Find comparables on OLX" button searches current OLX adverts through a web-only Hermes profile, shows them with checkboxes, and saves the ticked ones as comparables with their link.

**Architecture:** A shared OLX advert URL rule feeds both the candidate filter and the PUT validator. A backend `ComparableSearchService` checks the research profile's toolsets, sends a fixed prompt built from sanitized product fields through a second `HermesCompletionClient`, and filters the answer. The UI adds a button and a results dialog that merges ticked candidates into the existing price research form and saves via the existing PUT.

**Tech Stack:** TypeScript (Express, zod), React + MUI + RTK Query, Jest for pure functions, q4j (Java 21, TestNG) for live API/UI tests.

**Spec:** `docs/superpowers/specs/2026-11-21-olx-comparables-search-design.md`

## Global Constraints

- The research profile is reached only at `HERMES_RESEARCH_API_URL` with `HERMES_RESEARCH_API_KEY`; the `marketdesk` profile and its guard are untouched.
- Before every search: enabled toolsets (names with `enabled === true` from `GET {url}/toolsets`) must equal exactly `{web}`; otherwise 503 with a message that never contains the key.
- Seller free text (description, notes, comparable notes) never reaches the research prompt. Name is sanitized: URLs removed, only letters, digits, spaces and `-/.()+`, collapsed spaces, at most 120 chars.
- OLX advert URL rule (one shared constant): `^https://www\.olx\.pl/d/oferta/[a-z0-9-]+-CID\d+-ID[0-9A-Za-z]+\.html$`, matched after stripping query and fragment.
- Candidate filter: URL rule; price finite, `> 0`, `<= 100000`; currency equals listing currency; title trimmed, ≤ 200 chars; not the product's own listing `externalUrl` (normalized); dedup by URL; at most 10.
- Search offered only when the listing currency is `PLN`; else disabled with `OLX search needs a PLN listing`.
- `HERMES_RESEARCH_TIMEOUT_MS` default `120000`. AI usage: feature `research`, operation `searchComparables`.
- Messages (exact): `Market search is not configured`, `Hermes returned no usable results`, `No comparable adverts found`, `Keep at most 10 comparables — untick some`.
- The prompt keeps explicit steps: web_search with short buyer phrases → collect `https://www.olx.pl/d/oferta/…html` links → web_extract them → report each advert's own title and price, strict JSON array, `[]` if none.
- Tests: q4j for live behaviour; Jest only for pure functions, no mocks. The stack has no research profile; the real search is checked by hand on production.

## Review Focus

1. Hermes answers with prose or code fences around the JSON — parsed like other Hermes answers (Task 2 test `parsesFencedAnswer`).
2. Candidate URL with tracking query (`?search_reason=…`) — normalized, kept, and deduped against the same advert without query (Task 1 test `normalizesQueryAndFragment`, Task 2 test `dedupesNormalizedUrls`).
3. Research profile gains a second toolset (e.g. `browser`) after deploy — search refused, never runs (Task 2 test `refusesExtraToolset`).
4. Seller already has 9 comparables and ticks 3 — Add disabled with the cap message, nothing lost (Task 3 test `capBlocksOverflow`).
5. Product name containing a URL or `<item>` markup — removed before the prompt (Task 2 test `sanitizesNameMarkupAndUrls`).

---

### Task 1: Comparable source and OLX link rule

**Files:**
- Create: `src/shared/olxAdvertUrl.ts`
- Modify: `src/shared/types/index.ts` (`PriceComparable`), `src/backend/presentation/http/validation/schemas.ts` (`priceResearchSchema` comparable item), `src/frontend/components/product-detail/priceResearchModel.ts` (form row keeps `url`/`source`, client validation mirrors server)
- Test: `src/shared/__tests__/olxAdvertUrl.test.ts` (or the repo's shared test location), `priceResearchModel.test.ts`; q4j `PriceResearchTest`

**Interfaces:**
- Produces:
  ```ts
  export const OLX_ADVERT_URL_PATTERN: RegExp;
  export function normalizeOlxAdvertUrl(raw: string): string | null; // strips ?query and #fragment, returns null unless it matches the pattern
  // PriceComparable becomes { price: number; note: string; url?: string | null; source?: 'manual' | 'web' }
  ```
- PUT rules: `url` optional/null, https, ≤ 500 chars; when `source === 'web'`, `normalizeOlxAdvertUrl(url)` must be non-null; `source` absent = `manual`. The repository already stores comparables as JSONB — confirm `url`/`source` round-trip, no migration.

- [ ] **Step 1: Failing tests.** Jest: `acceptsOlxAdvert` (`https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html` → same string); `normalizesQueryAndFragment` (`…ID1btjsA.html?search_reason=search%7Corganic#x` → without query/fragment); `rejectsNonAdvert` (`https://olx.pl/elektronika/q-airpods`, `https://www.olx.pl/d/oferta/x.html`, `http://www.olx.pl/d/oferta/a-CID99-ID1a.html`, `https://evil.example/d/oferta/a-CID99-ID1a.html` → null). Model: a form row with `url`/`source: 'web'` survives `toPriceResearchForm`→`toPriceResearchBody`. q4j: `webComparableWithOlxUrlIsSaved` (read back url+source), `webComparableWithForeignUrlIsRejected` (400), `manualComparableWithoutUrlStillWorks`.
- [ ] **Step 2: Run** Jest files and `PriceResearchTest` on a stand — expect FAIL.
- [ ] **Step 3: Implement** the shared module, type change, schema refinement, model mirror.
- [ ] **Step 4: Run** the same — expect PASS; `npm run type-check`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(products): keep the OLX link of a comparable price`.

### Task 2: Market search API

**Files:**
- Create: `src/backend/application/services/ComparableSearchService.ts`, `src/backend/infrastructure/external/comparableSearchPrompt.ts`
- Modify: `src/backend/infrastructure/external/HermesAI.ts` (add `loadHermesResearchConfig(): HermesAIConfig | null`), `src/backend/presentation/http/routes/products.ts`, `ProductController.ts`, `src/backend/config/di/container.ts`, `docker-compose.yml` (pass `HERMES_RESEARCH_API_URL`, `HERMES_RESEARCH_API_KEY`, `HERMES_RESEARCH_TIMEOUT_MS`, all optional with empty defaults), `.env.example` (documented, empty)
- Test: `src/backend/infrastructure/external/__tests__/comparableSearchPrompt.test.ts`; q4j `ComparableSearchTest`

**Interfaces:**
- Consumes: `OLX_ADVERT_URL_PATTERN`, `normalizeOlxAdvertUrl` (Task 1); `HermesCompletionClient(config, usageSink)`; `HermesHealthProbe(config).isReachable()` → `{ reachable, enabledToolsets }`; `withAiUsageScope`; `IProductRepository.findByIdForWorkspace`, listings of the product.
- Produces:
  ```ts
  export interface ComparableCandidate { price: number; currency: string; title: string; url: string }
  export function sanitizeSearchName(name: string): string;
  export function buildComparableSearchPrompt(input: { name: string; condition: string; category: string; currency: string }): { system: string; prompt: string };
  export function parseComparableCandidates(raw: string): unknown[] | null; // tolerant JSON extraction as HermesAI.parseJson; null when not an array
  export function filterComparableCandidates(items: unknown[], ctx: { currency: string; ownUrl: string | null }): ComparableCandidate[];
  export function isResearchToolsetSafe(enabled: readonly string[]): boolean; // exactly {'web'}
  // ComparableSearchService.search(workspaceId: string, productId: string): Promise<{ candidates: ComparableCandidate[]; searchedAt: string }>
  ```
- HTTP: `POST /api/products/:id/price-research/search` (behind `aiLimiter`), no body. Errors: not configured → 503 `Market search is not configured`; unsafe toolsets or unreachable → 503 naming the toolsets/reachability, never the key; non-PLN listing or no listing → 400 `OLX search needs a PLN listing`; unparsable → 502 `Hermes returned no usable results`; empty after filter → 200 with `candidates: []` (UI shows `No comparable adverts found`); other workspace → 404.

- [ ] **Step 1: Failing tests.** Jest (pure): `sanitizesNameMarkupAndUrls` (input `Apple AirPods 4 <item>x</item> https://evil.example/a, bez ANC!!`: result contains `Apple AirPods 4` and `bez ANC`, contains none of `<`, `>`, `evil.example`, `https`, `!`, has no double spaces; a 300-char name yields ≤ 120 chars); `promptNeverContainsDescription` (build from fields only — the function has no description parameter; assert the prompt contains the sanitized name, `PLN`, and the words `web_search` and `web_extract`); `parsesFencedAnswer` (```` ```json [..] ``` ```` → array); `nonArrayIsNull` (`{"a":1}` → null); `filtersEachRule` (one valid + one per rule violated: foreign URL, price 0, price 100001, currency EUR, own advert URL with query → only the valid survives); `dedupesNormalizedUrls`; `capsAtTen`; `refusesExtraToolset` (`['web','browser']` → false), `refusesNoToolset` (`[]` → false), `acceptsWebOnly` (`['web']` → true). q4j: `searchWithoutResearchProfileIsNotConfigured` (503, message), `otherWorkspaceSearchIs404`, `searchRequiresLogin` (401).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** prompt module, config loader (null when URL or key empty or `your_`-prefixed key, as the main config treats placeholders), service (order: config → product/listing lookup & currency → probe/guard → completion in `withAiUsageScope({ feature: 'research', … })` with operation `searchComparables` → parse → filter), route, controller, DI, compose and env example.
- [ ] **Step 4: Run** Jest file, q4j `ComparableSearchTest` + `PriceResearchTest`, `npm run type-check`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(products): search OLX for comparable used prices`.

### Task 3: Search button and results dialog

**Files:**
- Create: `src/frontend/components/product-detail/ComparableSearchDialog.tsx`
- Modify: `src/frontend/state/api/productsApi.ts` (mutation `searchComparables: builder.mutation<{ candidates: ComparableCandidate[]; searchedAt: string }, string>`; `ComparableCandidate` type added to `src/shared/types/index.ts`), `priceResearchModel.ts`, `PriceResearchSection.tsx`, `src/frontend/components/hermes/HermesEventCard.tsx` or `estimateLines` caller (used-range source suffix)
- Test: `priceResearchModel.test.ts`; q4j UI `PriceResearchUiTest` (+ page object/steps)

**Interfaces:**
- Consumes: `POST /api/products/:id/price-research/search` (Task 2), `PriceComparable.url/source` (Task 1), existing `savePriceResearch`.
- Produces (pure, in `priceResearchModel.ts`):
  ```ts
  export function mergeFoundComparables(form: PriceResearchForm, picked: ComparableCandidate[]): PriceResearchForm; // appends { price, note: title, url, source: 'web' }, skips URLs already in form
  export function selectionFits(form: PriceResearchForm, pickedCount: number): boolean; // existing non-blank rows + picked <= MAX_COMPARABLES
  export function usedRangeSourceNote(research: PriceResearch | null): string | null; // e.g. '4 from OLX' when ≥1 web comparable, else null
  ```

UI: button `Find comparables on OLX` next to `Add comparable`, disabled with `OLX search needs a PLN listing` when currency ≠ PLN, shows progress while running. Dialog per spec sketch: rows ticked by default, `Open on OLX` link (`target="_blank" rel="noopener noreferrer"`), already-saved URLs ticked-and-disabled `already added`; footer `Add N selected` disabled with the cap message when `!selectionFits`. Adding merges and saves the full list through `savePriceResearch`; error toasts use the server message. Saved web rows show a small `OLX` link. Price card used-range line appends ` (N from OLX)` when `usedRangeSourceNote` is non-null and the range basis is `observed`. Read research with `currentData`.

- [ ] **Step 1: Failing tests.** Jest: `mergeAppendsWebRows`, `mergeSkipsKnownUrls`, `capBlocksOverflow` (9 existing + 3 picked → false; 7 + 3 → true), `sourceNoteCountsWebRows` (2 web + 1 manual → `2 from OLX`; none → null). q4j UI: `findComparablesShowsNotConfigured` (stack has no research profile: clicking the button shows `Market search is not configured`); `savedWebComparableShowsOlxLink` (seed a web comparable via API with an OLX URL, reload, the row shows an `OLX` link with that href).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Jest, q4j UI, `npm run type-check`, `npm run lint`, `npm run build`.
- [ ] **Step 5: Commit** `feat(ui): find comparable OLX prices and pick them with checkboxes`.

### After merge (owner-approved deploy)

- [ ] Add `HERMES_RESEARCH_API_URL=http://<host gateway>:8642/p/marketdesk-research/v1` (same host part as the current `HERMES_API_URL`), `HERMES_RESEARCH_API_KEY` (from `~/.hermes/profiles/marketdesk-research/.env`, never printed) to `~/projects/marketdesk-deploy/.env`; copy the new `docker-compose.yml` from the merged commit; switch the image tag; `up -d --no-build`.
- [ ] On AirPods 4: Find comparables on OLX → list with working OLX links → add → Analyze → used range `observed (N from OLX)`.
