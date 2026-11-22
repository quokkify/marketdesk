# Products page stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each catalogue row shows views with 7-day growth and a 14-day trend, AI "N to review" survives reloads, and the Attention tab becomes a computed "Needs action" tab.

**Architecture:** Pure functions (`productStats.ts`) turn listings, view events and awaiting counts into a `ProductStats` per product; `ProductStatsService` gathers their inputs from existing repositories plus one new analytics query (baseline event ids). Two read endpoints follow the `/conversations/awaiting` pattern (`{ byProductId }`). The product list accepts `needsAction=true` and sorts by `views` / `viewsDelta7d` using the same stats. The frontend reads both endpoints once per page and refreshes them after sync, analyze, approve and dismiss.

**Tech Stack:** Express + pg (backend), React 18 + MUI + RTK Query (frontend), Jest (pure functions, static markup), q4j API/UI tests in `test-automation`.

**Spec:** `docs/superpowers/specs/2026-11-22-products-page-simplification-design.md` — "Stage 2", "Review in place", "Calls made in the design", "Owner decisions recorded".

## Global Constraints

- No migration: view history already lives in `analytics_events` (`event_type='view'`, `quantity`, `listing_id`, `occurred_at`).
- Baseline rule: per listing, the earliest `view` event (by `occurred_at`, then `id`) is excluded from `viewsDelta7d`, `viewsByDay` and the no-growth check.
- Freshness: a listing is stale when `lastSyncAt` is null or older than 24 hours; stale → `viewsDelta7d: null`, no trend, UI shows "stale" in amber.
- Windows: `viewsDelta7d` = sum over the last 7×24 h; `viewsByDay` = 14 UTC-day buckets, oldest first, the last bucket is today.
- Needs action (products with status `active` only), reasons: `buyer_waiting` (awaiting count > 0), `listing_problem` (listing status `expired` or `error`), `no_view_growth` (listing `live`, not stale, `publishedAt` ≤ now − 7 days, `viewsDelta7d === 0`). Pending AI suggestions are NOT a reason.
- Several listings per product: views/watchers/messages and `viewsByDay` summed; `lastSyncAt` = most recent; `externalUrl` = the live listing's, else the most recently synced; status = worst of `error > expired > draft > live`.
- Tab value `needs-action`, label `Needs action`; `?tab=attention` parses to `needs-action`.
- UI copy (English): `Views · 7 days` (column), `▲ +N`, `no growth`, `stale`, `N watching · N msgs · synced <relative>`, `—` for not published; reasons `Buyer waiting`, `Listing expired or failing on OLX`, `No view growth for 7 days`; hint `Condition not confirmed`.
- New behaviour tests: pure functions in Jest without mocks; endpoints and screens in q4j (`test.api` → `./gradlew apiTest`, `test.ui` → `./gradlew uiTest`). Local Jest: `SKIP_REDIS_TESTS=true npx jest --forceExit <paths>`; Java: `JAVA_HOME=$(brew --prefix openjdk@21)`.
- Route order: `/products/stats` before `/products/:id`; `/hermes/events/pending-counts` before `/hermes/events/:id`.

## Review Focus

1. **Listing synced once, long ago** — must read "stale", never "no growth", and must not enter Needs action. Pinned in Task 1 (`summarizeProduct` stale case, `needsActionReasons` stale case).
2. **Imported listing whose first sync recorded the whole historical total** — no fake spike: the baseline is dropped even inside the 14-day window. Pinned in Task 1 (`summarizeListingViews` baseline-in-window case).
3. **Listing published less than 7 days ago with zero growth** — not "no growth" yet. Pinned in Task 1.
4. **Draft or sold product with an expired listing** — not in Needs action (status `active` only). Pinned in Task 1.
5. **Product with no listing at all** — absent from stats, renders `—`, sorts last by views in both directions. Pinned in Task 1 (`compareByStats`) and Task 4 (static markup).

---

### Task 1: Stats math and Needs action rules

**Files:**
- Modify: `src/shared/types/index.ts` (add the types below next to `Listing`)
- Create: `src/backend/application/services/productStats.ts`
- Test: `src/backend/application/services/__tests__/productStats.test.ts`

**Interfaces:**
- Produces (shared types):
  - `type NeedsActionReason = 'buyer_waiting' | 'listing_problem' | 'no_view_growth'`
  - `interface ProductStats { views: number | null; watchers: number | null; messages: number | null; viewsDelta7d: number | null; viewsByDay: number[]; lastSyncAt: string | null; stale: boolean; externalUrl: string | null; listingStatus: ListingStatus | null; needsAction: NeedsActionReason[] }`
- Produces (`productStats.ts`):
  - `const STATS_DAYS = 14`, `const GROWTH_WINDOW_MS = 7 * 24 * 3600 * 1000`, `const STALE_AFTER_MS = 24 * 3600 * 1000`
  - `summarizeListingViews(events: ReadonlyArray<{ id: string; listingId: string | null; eventType: string; quantity: number; occurredAt: Date }>, baselineIds: ReadonlySet<string>, now: Date): Map<string, { delta7d: number; byDay: number[] }>`
  - `interface StatsListing { productId: string; status: ListingStatus; views: number | null; watchers: number | null; messages: number | null; lastSyncAt: Date | null; publishedAt: Date | null; externalUrl: string | null }`
  - `summarizeProduct(listings: readonly StatsListing[], views: Map<string, { delta7d: number; byDay: number[] }>, listingIds: readonly string[], now: Date): Omit<ProductStats, 'needsAction'> & { oldestLivePublishedAt: Date | null }` — `listingIds[i]` is the id of `listings[i]`.
  - `needsActionReasons(input: { productStatus: ProductStatus; awaiting: number; stats: Omit<ProductStats, 'needsAction'> & { oldestLivePublishedAt: Date | null } | undefined; now: Date }): NeedsActionReason[]` — reasons in the order `buyer_waiting`, `listing_problem`, `no_view_growth`.
  - `compareByStats(a: ProductStats | undefined, b: ProductStats | undefined, field: 'views' | 'viewsDelta7d'): number` — ascending; a missing value (no stats, `null`) compares as greater than any number in ascending order AND is placed last by callers in descending order (callers negate only defined pairs).

- [ ] **Step 1: Write the failing tests**

```ts
const now = new Date('2026-11-22T12:00:00Z');
const ev = (id: string, listingId: string, quantity: number, iso: string) =>
  ({ id, listingId, eventType: 'view', quantity, occurredAt: new Date(iso) });

it('drops the baseline event even inside the window and buckets by UTC day', () => {
  const views = summarizeListingViews(
    [ev('b', 'L1', 500, '2026-11-21T15:00:00Z'), ev('e1', 'L1', 3, '2026-11-21T20:00:00Z'),
     ev('e2', 'L1', 2, '2026-11-22T10:00:00Z'), { ...ev('m', 'L1', 9, '2026-11-22T10:00:00Z'), eventType: 'message' }],
    new Set(['b']), now);
  expect(views.get('L1')!.delta7d).toBe(5);
  expect(views.get('L1')!.byDay).toHaveLength(14);
  expect(views.get('L1')!.byDay.slice(-2)).toEqual([3, 2]);
});
it('ignores events older than the windows', () => {
  const views = summarizeListingViews([ev('o', 'L1', 4, '2026-11-01T00:00:00Z')], new Set(), now);
  expect(views.get('L1')?.delta7d ?? 0).toBe(0);
  expect((views.get('L1')?.byDay ?? []).every((n) => n === 0)).toBe(true);
});
it('marks a listing synced more than 24 hours ago as stale without growth', () => {
  const s = summarizeProduct([{ productId: 'p', status: 'live', views: 40, watchers: 2, messages: 1,
    lastSyncAt: new Date('2026-11-21T11:59:00Z'), publishedAt: new Date('2026-11-01T00:00:00Z'), externalUrl: 'u' }],
    new Map(), ['L1'], now);
  expect(s.stale).toBe(true);
  expect(s.viewsDelta7d).toBeNull();
});
it('sums several listings and keeps the worst status and the live url', () => {
  const s = summarizeProduct([
    { productId: 'p', status: 'live', views: 10, watchers: 1, messages: 0, lastSyncAt: new Date('2026-11-22T11:00:00Z'), publishedAt: null, externalUrl: 'live-url' },
    { productId: 'p', status: 'expired', views: 5, watchers: null, messages: 2, lastSyncAt: new Date('2026-11-22T09:00:00Z'), publishedAt: null, externalUrl: 'old-url' },
  ], new Map([['L1', { delta7d: 3, byDay: Array(14).fill(0) }], ['L2', { delta7d: 1, byDay: Array(14).fill(0) }]]), ['L1', 'L2'], now);
  expect(s).toMatchObject({ views: 15, watchers: 1, messages: 2, viewsDelta7d: 4, listingStatus: 'expired', externalUrl: 'live-url', stale: false });
});
it.each([
  ['buyer waiting', { awaiting: 1 }, ['buyer_waiting']],
  ['expired listing', { listingStatus: 'expired' }, ['listing_problem']],
  ['no growth for a week', { viewsDelta7d: 0, published: '2026-11-10T00:00:00Z' }, ['no_view_growth']],
  ['young listing', { viewsDelta7d: 0, published: '2026-11-20T00:00:00Z' }, []],
  ['stale listing', { viewsDelta7d: null, stale: true, published: '2026-11-01T00:00:00Z' }, []],
  ['growing listing', { viewsDelta7d: 4, published: '2026-11-01T00:00:00Z' }, []],
])('needs action: %s', (_name, o, expected) => {
  const stats = { views: 1, watchers: 0, messages: 0, viewsDelta7d: 'viewsDelta7d' in o ? o.viewsDelta7d : 2,
    viewsByDay: [], lastSyncAt: now.toISOString(), stale: Boolean(o.stale), externalUrl: null,
    listingStatus: o.listingStatus ?? 'live', oldestLivePublishedAt: o.published ? new Date(o.published) : null };
  expect(needsActionReasons({ productStatus: 'active', awaiting: o.awaiting ?? 0, stats, now })).toEqual(expected);
});
it('never flags products that are not active', () => {
  const stats = { views: 1, watchers: 0, messages: 0, viewsDelta7d: 0, viewsByDay: [], lastSyncAt: now.toISOString(),
    stale: false, externalUrl: null, listingStatus: 'expired' as const, oldestLivePublishedAt: null };
  expect(needsActionReasons({ productStatus: 'draft', awaiting: 2, stats, now })).toEqual([]);
  expect(needsActionReasons({ productStatus: 'sold', awaiting: 2, stats, now })).toEqual([]);
});
it('sorts products without stats last in both directions', () => {
  const s = (views: number | null) => ({ views } as ProductStats);
  expect(compareByStats(s(1), s(5), 'views')).toBeLessThan(0);
  expect(compareByStats(undefined, s(5), 'views')).toBeGreaterThan(0);
  expect(compareByStats(s(null), s(0), 'views')).toBeGreaterThan(0);
});
```

(Type the `it.each` rows loosely — `as never` casts are fine in the test only.)

- [ ] **Step 2: Run to verify they fail** — `SKIP_REDIS_TESTS=true npx jest --forceExit src/backend/application/services/__tests__/productStats.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** per the Interfaces block and Global Constraints. Day bucket index = `13 - floor((startOfUtcDay(now) - startOfUtcDay(occurredAt)) / day)`, skip indexes outside `0..13`. `oldestLivePublishedAt` = earliest `publishedAt` among `live` listings (null if none).
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** — `feat(products): compute per-product view growth and needs-action reasons`

---

### Task 2: Stats service, endpoints, list filter and sort

**Files:**
- Modify: `src/backend/application/ports/IAnalyticsEventRepository.ts`, `src/backend/infrastructure/persistence/repositories/AnalyticsEventRepository.ts` (new method)
- Create: `src/backend/application/services/ProductStatsService.ts`
- Modify: `src/backend/application/dto/ListProductsQueryDTO.ts`, `src/backend/application/services/ProductApplicationService.ts`, `src/backend/presentation/http/controllers/ProductController.ts`, `src/backend/presentation/http/routes/products.ts`, `src/backend/presentation/http/controllers/HermesController.ts`, `src/backend/presentation/http/routes/hermes.ts`, `src/backend/config/di/container.ts`
- Test: Task 5 (live API). No Jest mocks.

**Interfaces:**
- Consumes: Task 1 functions and types; `IListingRepository.findByWorkspace`, `IProductRepository.findByWorkspace`, `IConversationRepository.awaitingReplyCounts`, `IEventRepository.findPendingReview`, `IAnalyticsEventRepository.findByRange`.
- Produces:
  - `IAnalyticsEventRepository.baselineViewEventIds(workspaceId: string): Promise<Set<string>>` — SQL `SELECT DISTINCT ON (listing_id) id FROM analytics_events WHERE workspace_id = $1 AND event_type = 'view' AND listing_id IS NOT NULL ORDER BY listing_id, occurred_at, id`.
  - `class ProductStatsService { constructor(deps: { products, listings, analytics, conversations?, now?: () => Date }); statsByProduct(workspaceId: string): Promise<Record<string, ProductStats>> }` — reads view events for `[now − 14 days, now]`; missing `conversations` ⇒ awaiting 0.
  - `pendingCountsByProduct(events: HermesEvent[]): Record<string, number>` exported from `ProductStatsService.ts` (counts `pending_review` events with a `productId`).
  - `GET /products/stats` → `ok(res, { byProductId })`; `GET /hermes/events/pending-counts` → `ok(res, { byProductId })`.
  - `ListProductsQueryDTO.needsAction?: boolean` (controller: `req.query.needsAction === 'true'`); `ProductApplicationService.listProducts(query, stats?: Record<string, ProductStats>)` — with `needsAction` keeps products whose `stats[id]?.needsAction.length > 0`; sort fields `views` and `viewsDelta7d` use `compareByStats` with missing values last in both directions. The controller passes stats only when `needsAction` is set or the sort uses `views`/`viewsDelta7d`.

- [ ] **Step 1:** Add the repository method and `ProductStatsService` per Interfaces; wire it in `container.ts` next to `productService`, passing it to `ProductController` and `HermesController` (pending counts via `findPendingReview`).
- [ ] **Step 2:** Routes and controller handlers in the order Global Constraints fixes; list query flag and sort.
- [ ] **Step 3: Verify** — `npm run type-check`, `npm run lint`, `SKIP_REDIS_TESTS=true npx jest --forceExit src/backend` (existing suites green). The behaviour is pinned by Task 5.
- [ ] **Step 4: Commit** — `feat(products): serve product stats, pending AI counts and the needs-action filter`

---

### Task 3: Frontend data and state

**Files:**
- Modify: `src/frontend/state/api/productsApi.ts` (or the file defining `getProducts`), `src/frontend/state/api/hermesApi.ts`, `src/frontend/state/api/index.ts`
- Modify: `src/frontend/pages/productsCatalogueState.ts`, `src/frontend/pages/productsRowAnalysis.ts`
- Test: `src/frontend/pages/productsCatalogueState.test.ts`, `src/frontend/pages/productsRowAnalysis.test.ts`

**Interfaces:**
- Produces:
  - RTK: `getProductStats: query<Record<string, ProductStats>, void>` (`/products/stats`, unwraps `byProductId`, `providesTags: [{ type: 'Product', id: 'STATS' }]`), `getHermesPendingCounts: query<Record<string, number>, void>` (`/hermes/events/pending-counts`, `providesTags: [{ type: 'HermesEvent', id: 'PENDING_COUNTS' }]`); `runHermes`, `approveHermesEvent`, `dismissHermesEvent` additionally invalidate `PENDING_COUNTS`; marketplace sync invalidates `{ type: 'Product', id: 'STATS' }`. Hooks `useGetProductStatsQuery`, `useGetHermesPendingCountsQuery`.
  - `ProductListParams.needsAction?: boolean` serialized as `needsAction=true`.
  - `ProductsTab = 'all' | 'active' | 'needs-action' | 'draft' | 'sold'`; `parseProductsCatalogueState('?tab=attention').tab === 'needs-action'`; `tabStatus('needs-action') === undefined` and new `tabNeedsAction(tab): boolean`; `visibleProductTabs()` (no argument) → `['all', 'active', 'needs-action', 'draft', 'sold']`. `SORTS` and `PRODUCT_SORT_OPTIONS` gain `-viewsDelta7d` ("Most growth"), `viewsDelta7d` ("Least growth"), `-views` ("Most views").
  - `needsActionLabel(reason: NeedsActionReason): string` with the exact copy from Global Constraints.
  - `viewsSummary(stats: ProductStats | undefined): { primary: string; delta: { kind: 'up' | 'flat' | 'stale'; text: string } | null; secondary: string | null }` — `—`/null/null when no stats or `views === null`; stale → `{ kind: 'stale', text: 'stale' }`; delta > 0 → `▲ +N`; 0 → `no growth`; secondary `N watching · N msgs · synced <formatRelative(lastSyncAt)>`.
  - `sparklinePoints(values: readonly number[], width: number, height: number): string` — SVG `points`; all-equal values draw a flat line at mid height; empty → `''`.
  - `analysisStateFor(session: RowAnalysisState | undefined, pending: number | undefined): RowAnalysisState | undefined` — session wins when `running` or `error`; otherwise `pending > 0` → `{ status: 'done', count: pending }`; else session.

- [ ] **Step 1: Write the failing tests** — for each produced pure function, cases from its line above, e.g.:

```ts
expect(parseProductsCatalogueState('?tab=attention').tab).toBe('needs-action');
expect(visibleProductTabs()).toEqual(['all', 'active', 'needs-action', 'draft', 'sold']);
expect(viewsSummary({ ...base, views: 128, viewsDelta7d: 14 }).delta).toEqual({ kind: 'up', text: '▲ +14' });
expect(viewsSummary({ ...base, views: 41, viewsDelta7d: 0 }).delta).toEqual({ kind: 'flat', text: 'no growth' });
expect(viewsSummary({ ...base, views: 203, viewsDelta7d: null, stale: true }).delta).toEqual({ kind: 'stale', text: 'stale' });
expect(viewsSummary(undefined)).toEqual({ primary: '—', delta: null, secondary: null });
expect(sparklinePoints([3, 3, 3], 70, 18)).toBe('0,9 35,9 70,9');
expect(sparklinePoints([], 70, 18)).toBe('');
expect(analysisStateFor(undefined, 2)).toEqual({ status: 'done', count: 2 });
expect(analysisStateFor({ status: 'running' }, 2)).toEqual({ status: 'running' });
expect(analysisStateFor({ status: 'reviewed' }, 0)).toEqual({ status: 'reviewed' });
expect(needsActionLabel('no_view_growth')).toBe('No view growth for 7 days');
```

- [ ] **Step 2: Run to verify they fail** — `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/pages/productsCatalogueState.test.ts src/frontend/pages/productsRowAnalysis.test.ts` → FAIL.
- [ ] **Step 3: Implement** per Interfaces (update the existing tests that expected `attention` or `visibleProductTabs(n)`).
- [ ] **Step 4: Run to verify they pass**, plus `npm run type-check`.
- [ ] **Step 5: Commit** — `feat(products): load product stats and persistent pending counts`

---

### Task 4: Views column, reasons, Needs action tab, listing link

**Files:**
- Modify: `src/frontend/components/tables/ProductsTable.tsx`, `src/frontend/pages/ProductsPage.tsx`
- Create: `src/frontend/components/common/Sparkline.tsx`
- Test: `src/frontend/components/tables/ProductsTable.test.tsx`

**Interfaces:**
- Consumes: Task 3 functions, hooks and types.
- Produces: `PRODUCT_TABLE_COLUMNS` keys `['select','product','status','price','views','ai','actions']` (`views`: label `Views · 7 days`, `sortField: 'viewsDelta7d'`); `ProductsCollectionProps.statsByProductId?: Record<string, ProductStats>`; `Sparkline: React.FC<{ values: readonly number[]; width?: number; height?: number }>` (default 70×18, single colour, `aria-hidden`).

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows views, growth, trend and freshness', () => {
  const html = markup(<ProductsTable products={[product]} statsByProductId={{ 'p-1': stats({ views: 128, viewsDelta7d: 14 }) }} />);
  expect(html).toContain('Views · 7 days'); expect(html).toContain('128'); expect(html).toContain('▲ +14');
  expect(html).toContain('<polyline'); expect(html).toContain('watching');
});
it('shows stale without a trend and a dash without stats', () => {
  const html = markup(<ProductsTable products={[product, other]} statsByProductId={{ 'p-1': stats({ views: 203, viewsDelta7d: null, stale: true }) }} />);
  expect(html).toContain('stale'); expect(html).not.toContain('<polyline'); expect(html).toContain('—');
});
it('lists needs-action reasons and the condition hint under the status', () => {
  const html = markup(<ProductsTable products={[{ ...product, condition: 'unknown' }]}
    statsByProductId={{ 'p-1': stats({ needsAction: ['buyer_waiting', 'no_view_growth'] }) }} />);
  expect(html).toContain('Buyer waiting'); expect(html).toContain('No view growth for 7 days'); expect(html).toContain('Condition not confirmed');
});
it('links the short listing id to the OLX advert in a new tab', () => {
  const html = markup(<ProductsTable products={[imported]} statsByProductId={{ 'p-1': stats({ externalUrl: 'https://www.olx.pl/d/oferta/x.html' }) }} />);
  expect(html).toContain('href="https://www.olx.pl/d/oferta/x.html"'); expect(html).toContain('target="_blank"');
});
```

- [ ] **Step 2: Run to verify they fail** — `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/components/tables/ProductsTable.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Table: Views cell replaces Updated (primary in bold tabular-nums, delta coloured success/text.secondary/warning, `Sparkline` only when not stale and `viewsByDay.length`, secondary caption); reasons as violet captions under the status, the condition hint amber; listing link (`rel="noopener noreferrer"`, carries `data-row-stop`). Page: fetch stats and pending counts; list `needsAction` when `tabNeedsAction(tab)`; tab counts `Needs action` from `useProducts({ needsAction: true, limit: 1 })` (drop the attention count); pass `statsByProductId`; AI state per row = `analysisStateFor(session[id], pendingCounts[id])`.
- [ ] **Step 4: Verify** — the test command PASS; `npm run lint`, `npm run type-check`, `npm run build:frontend`, `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend`.
- [ ] **Step 5: Commit** — `feat(products): show view growth and a needs-action tab in the catalogue`

---

### Task 5: Live API and UI tests

**Files:**
- Create: `test-automation/src/test/java/dev/quokkify/marketdesk/test/api/ProductStatsTest.java`, matching step/service methods in `ProductSteps` (and its service) for `GET /products/stats`, `GET /products?needsAction=true`, `GET /hermes/events/pending-counts`
- Modify: `test-automation/.../test/ui/ProductsCatalogueUiTest.java`, `ProductsPage`, `ProductsPageSteps`, `ProductsPageVerification`

**Interfaces:**
- Consumes: endpoints from Task 2; UI from Task 4; existing `listingSteps.createOlxProductListing`, `publishSandboxOlxListing`, `markExpiredOnOlx`, `marketplaceSteps.syncOlx`, `productSteps.proposeImprovements`.

- [ ] **Step 1: Write the tests**
  - `statsListEveryListedProduct`: a fresh account with one OLX listing → `byProductId[productId]` exists with `listingStatus`, `viewsByDay` of size 14.
  - `pendingCountsFollowSuggestions`: after `proposeImprovements` → `byProductId[productId] >= 1`; after dismissing those events → key absent or 0.
  - `expiredActiveProductNeedsAction`: an active product whose listing is marked expired (publish, then `markExpiredOnOlx`, then `syncOlx` if the status needs it) → appears in `/products?needsAction=true` and its stats carry `listing_problem`; a draft product with an expired listing does not appear.
  - Unauthenticated `GET /products/stats` and `/hermes/events/pending-counts` → `HttpStatus.SC_UNAUTHORIZED`.
  - UI `catalogueShowsViewsColumn` (`Views · 7 days` header, no `Updated`) and `needsActionTabListsExpiredListing`.
  Confirm on a stand or in CI which helper leaves the product `active`; record the choice as a ruling.
- [ ] **Step 2: Run** — `JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew compileJava compileTestJava archgateCheck checkstyleMain checkstyleTest test`; `apiTest`/`uiTest` run in CI on the PR (the local stand is unavailable while the owner's stack runs). Expected: all green in CI.
- [ ] **Step 3: Commit** — `test: product stats, pending counts and the needs-action tab`
