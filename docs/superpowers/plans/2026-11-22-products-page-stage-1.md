# Products page stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simpler Products page: four empty columns gone, filters gap fixed, AI analysis from the row and for selected rows, short listing id, clickable row, Sold tab.

**Architecture:** Frontend only. Pure helpers in `productsCatalogueState.ts` and a new `productsRowAnalysis.ts` carry every decision that Jest can check without a DOM; `ProductsTable.tsx` renders them; `ProductsPage.tsx` wires the existing `useRunHermes` mutation and Hermes settings query. Browser behaviour (gap, clicks, analysis end to end) is pinned by a live q4j UI test.

**Tech Stack:** React 18, MUI, RTK Query, react-router, Jest + `renderToStaticMarkup` (no DOM), q4j/TestNG/Selenide in `test-automation`.

**Spec:** `docs/superpowers/specs/2026-11-22-products-page-simplification-design.md` (section "Stage 1 — frontend only" and "Calls made in the design").

## Global Constraints

- No backend changes, no new dependencies.
- UI copy is English, like the rest of the app. Exact strings: `N to review` (N ≥ 1), `No new suggestions`, `Analyze with AI` (button label, menu item, aria), `Analyze selected`, `Search name or OLX id`, tab label `Sold`.
- `costPrice` / `-costPrice` stay in the URL `SORTS` whitelist; only the menu stops offering them.
- `?tab=attention` keeps parsing; the Attention tab is hidden only while its count is 0.
- The shared `Card` (`src/frontend/components/common/Card.tsx`) does not change.
- Frontend tests have no DOM: pure functions and `renderToStaticMarkup` only. Clicks, gap and live analysis go to `test-automation` (`test.ui`, run by `./gradlew uiTest`).
- `tsconfig` excludes `*.test.*`: type-check tests with a temporary tsconfig that includes them.
- Local Jest: `SKIP_REDIS_TESTS=true npx jest --forceExit <paths>`.
- Java: `JAVA_HOME=$(brew --prefix openjdk@21)` for Gradle in `test-automation`.

## Review Focus

1. **429 in the middle of a bulk run** — finished rows keep their result, the remaining rows return to idle, the toast says how many were not analyzed. Pinned in Task 3 (`runSequentially` stops on 429).
2. **Click on checkbox, ✦ or ⋮ inside a clickable row** — must not open the product. Pinned in Task 2 (`rowClickIntent` returns `ignore` for stop targets) and Task 5 (UI test clicks ✦ and stays on the page).
3. **SKUs that are not `OLX-<uuid>-<id>`** (manual products, other marketplaces, an id containing dashes) — shown unchanged, never truncated wrongly. Pinned in Task 1 (`shortListingSku` cases).
4. **Hermes listing SEO agent switched off or settings still loading** — ✦ disabled with the reason as tooltip; bulk refuses with the same reason. Pinned in Task 3 (`rowAnalyzeDisabledReason`) and Task 4 wiring.
5. **Analyzing the same row twice quickly** — the button is disabled while running, so one request at a time per row. Pinned in Task 3 (`canStartRowAnalysis`).

---

### Task 1: Catalogue state helpers

**Files:**
- Modify: `src/frontend/pages/productsCatalogueState.ts`
- Test: `src/frontend/pages/productsCatalogueState.test.ts`

**Interfaces:**
- Produces:
  - `type ProductsTab = 'all' | 'active' | 'attention' | 'draft' | 'sold'` (`TABS` accepts `sold`; `tabStatus('sold')` → `['sold']`).
  - `PRODUCT_SORT_OPTIONS` without the two Cost entries.
  - `shortListingSku(sku: string): string`
  - `visibleProductTabs(attentionCount: number | undefined): ProductsTab[]`

- [ ] **Step 1: Write the failing tests**

```ts
describe('stage 1 catalogue helpers', () => {
  it('shortens an imported marketplace SKU to the marketplace and advert id', () => {
    expect(shortListingSku('OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120')).toBe('OLX · 1085784120');
  });
  it.each(['SKU-100', 'OLX-1085784120', 'olx-5e881fca-2811-4a73-aaaf-da9b23f485a1-1', ''])(
    'leaves a SKU that is not an imported marketplace SKU unchanged: %s',
    (sku) => expect(shortListingSku(sku)).toBe(sku)
  );
  it('keeps dashes inside the advert id', () => {
    expect(shortListingSku('OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-ab-12')).toBe('OLX · ab-12');
  });
  it('parses the sold tab and maps it to the sold status', () => {
    expect(parseProductsCatalogueState('?tab=sold').tab).toBe('sold');
    expect(tabStatus('sold')).toEqual(['sold']);
  });
  it('still parses old attention links', () => {
    expect(parseProductsCatalogueState('?tab=attention').tab).toBe('attention');
  });
  it('hides the attention tab while it is empty or unknown', () => {
    expect(visibleProductTabs(0)).toEqual(['all', 'active', 'draft', 'sold']);
    expect(visibleProductTabs(undefined)).toEqual(['all', 'active', 'draft', 'sold']);
    expect(visibleProductTabs(2)).toEqual(['all', 'active', 'attention', 'draft', 'sold']);
  });
  it('no longer offers cost sorting in the menu but accepts it from old URLs', () => {
    expect(PRODUCT_SORT_OPTIONS.map((o) => o.value)).not.toContain('costPrice');
    expect(PRODUCT_SORT_OPTIONS.map((o) => o.value)).not.toContain('-costPrice');
    expect(parseProductsCatalogueState('?sort=-costPrice').sort).toBe('-costPrice');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/pages/productsCatalogueState.test.ts`
Expected: FAIL (`shortListingSku` / `visibleProductTabs` not exported, `sold` tab parses to `all`).

- [ ] **Step 3: Implement**

`shortListingSku`: match `^([A-Z]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$`; on match return `` `${m[1]} · ${m[2]}` ``, else the input. Add `'sold'` to `ProductsTab` and `TABS`. Remove the two Cost entries from `PRODUCT_SORT_OPTIONS` only. The existing test "offers only sort orders that the catalogue URL parser accepts" must stay green.

- [ ] **Step 4: Run to verify they pass** — same command, expected PASS.

- [ ] **Step 5: Commit** — `feat(products): sold tab, short listing id and attention visibility helpers`

---

### Task 2: Leaner table and cards, clickable row

**Files:**
- Modify: `src/frontend/components/tables/ProductsTable.tsx`
- Test: `src/frontend/components/tables/ProductsTable.test.tsx`

**Interfaces:**
- Consumes: `shortListingSku` (Task 1).
- Produces:
  - `export const PRODUCT_TABLE_COLUMNS: ReadonlyArray<{ key: 'select' | 'product' | 'status' | 'price' | 'updated' | 'ai' | 'actions'; label: string; sortField?: string; align?: 'right' }>` — header cells and the skeleton's cell count come from it.
  - `export function rowClickIntent(event: { metaKey: boolean; ctrlKey: boolean; button: number; insideStop: boolean }): 'open' | 'new-tab' | 'ignore'`
  - Cells excluded from row opening carry `data-row-stop` (checkbox, AI, actions cells); the product title is a react-router `Link` to `/products/:id`.
  - `ProductsCollectionProps` gains nothing in this task; the `ai` column renders an empty cell until Task 3.

- [ ] **Step 1: Write the failing tests** (replace the assertions in the existing "renders product identity…" test that expect margin, tags and marketplace absence)

```tsx
it('renders only the stage 1 columns', () => {
  expect(PRODUCT_TABLE_COLUMNS.map((c) => c.key)).toEqual(['select', 'product', 'status', 'price', 'updated', 'ai', 'actions']);
  const html = renderToStaticMarkup(<MemoryRouter><ProductsTable products={[product]} currency="PLN" /></MemoryRouter>);
  for (const gone of ['Markets', 'Cost', 'Profit', 'Tags', 'featured', 'margin', 'Marketplace count unavailable']) {
    expect(html).not.toContain(gone);
  }
  expect(html).toContain('250 zł');
});
it('shows the short listing id with the full SKU as its title', () => {
  const imported = { ...product, sku: 'OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120' };
  const html = renderToStaticMarkup(<MemoryRouter><ProductsTable products={[imported]} /></MemoryRouter>);
  expect(html).toContain('OLX · 1085784120');
  expect(html).toContain('title="OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120"');
});
it('links the product title to its page', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ProductsTable products={[product]} onOpen={() => {}} /></MemoryRouter>);
  expect(html).toContain('href="/products/p-1"');
});
it('cards drop cost, profit, markets and tags', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ProductsCards products={[product]} currency="PLN" /></MemoryRouter>);
  for (const gone of ['Cost', 'Profit', 'Markets', 'featured']) expect(html).not.toContain(gone);
});
it.each([
  [{ metaKey: false, ctrlKey: false, button: 0, insideStop: false }, 'open'],
  [{ metaKey: true, ctrlKey: false, button: 0, insideStop: false }, 'new-tab'],
  [{ metaKey: false, ctrlKey: true, button: 0, insideStop: false }, 'new-tab'],
  [{ metaKey: false, ctrlKey: false, button: 1, insideStop: false }, 'new-tab'],
  [{ metaKey: false, ctrlKey: false, button: 0, insideStop: true }, 'ignore'],
  [{ metaKey: true, ctrlKey: false, button: 0, insideStop: true }, 'ignore'],
])('row click %o → %s', (event, intent) => expect(rowClickIntent(event)).toBe(intent));
```

The skeleton test (if any) asserts 7 cells per skeleton row.

- [ ] **Step 2: Run to verify they fail**

Run: `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/components/tables/ProductsTable.test.tsx`
Expected: FAIL (old columns present, no `PRODUCT_TABLE_COLUMNS` / `rowClickIntent`).

- [ ] **Step 3: Implement**

- Delete the Markets, Cost, Profit, Tags header and body cells, the `Profit` component and the card blocks for Cost, Profit, Markets and tags. Header and skeleton map over `PRODUCT_TABLE_COLUMNS`; table `minWidth` 820.
- Title: two-line clamp (`display: '-webkit-box'`, `WebkitLineClamp: 2`, `WebkitBoxOrient: 'vertical'`, `overflow: 'hidden'`), full name in `title`. Second line `shortListingSku(product.sku)` with `title={product.sku}`.
- Title is `component={Link} to={`/products/${product.id}`}` (react-router), replacing the `ButtonBase`.
- `TableRow` gets `onClick` and `onAuxClick`: compute `insideStop` as `Boolean((event.target as HTMLElement).closest('[data-row-stop]'))`; `open` → `onOpen(product)`; `new-tab` → `window.open('/products/' + id, '_blank', 'noopener')`; clicks on the title link itself are left to the link (stop propagation on the link). Row `sx={{ cursor: onOpen ? 'pointer' : undefined }}`.
- Existing tests that render the table now wrap it in `MemoryRouter`.

- [ ] **Step 4: Run to verify they pass** — same command, expected PASS.

- [ ] **Step 5: Commit** — `feat(products): drop empty columns, short listing id, clickable rows`

---

### Task 3: Row analysis state, bulk runner, AI column and menu item

**Files:**
- Create: `src/frontend/pages/productsRowAnalysis.ts`
- Create: `src/frontend/pages/productsRowAnalysis.test.ts`
- Modify: `src/frontend/components/tables/ProductsTable.tsx`
- Test: `src/frontend/components/tables/ProductsTable.test.tsx`

**Interfaces:**
- Consumes: `PRODUCT_TABLE_COLUMNS` `ai` column and `data-row-stop` (Task 2); `productHermesDisabledReason` from `src/frontend/pages/ListingDetailsPage.tsx`.
- Produces (in `productsRowAnalysis.ts`):
  - `type RowAnalysisState = { status: 'running' } | { status: 'done'; count: number } | { status: 'error'; message: string }`
  - `rowAnalysisLabel(state: RowAnalysisState | undefined): string | null` — `null` for undefined/running, `` `${count} to review` `` for count ≥ 1, `No new suggestions` for 0, the message for error.
  - `canStartRowAnalysis(state: RowAnalysisState | undefined, disabledReason: string | null): boolean`
  - `rowAnalyzeDisabledReason(input: { settingsLoaded: boolean; listingSeoEnabled: boolean }): string | null` — delegates to `productHermesDisabledReason` with a non-empty product id placeholder so only the settings reasons apply.
  - `runSequentially(ids: readonly string[], run: (id: string) => Promise<number>, onState: (id: string, state: RowAnalysisState) => void): Promise<{ analyzed: number; notRun: string[] }>` — one at a time; before each id emits `running`; on success `done` with the count; on an error whose `status === 429` emits the error for that id, stops, and returns the rest (including that id) in `notRun`; any other error marks that id `error` and continues.
  - `ProductRowHandlers.onAnalyze?: (product: Product) => void`; `productRowMenuItems` adds `Analyze with AI` as the first item when `onAnalyze` is set (disabled when `analyzeDisabledReason` is set).
  - `ProductsCollectionProps` gains `analysisByProductId?: Record<string, RowAnalysisState>`, `onAnalyze?: (product: Product) => void`, `analyzeDisabledReason?: string | null`, `analysisHref?: (product: Product) => string` (target of the `N to review` link).

- [ ] **Step 1: Write the failing tests** (`productsRowAnalysis.test.ts`)

```ts
it.each([
  [undefined, null], [{ status: 'running' }, null],
  [{ status: 'done', count: 2 }, '2 to review'], [{ status: 'done', count: 1 }, '1 to review'],
  [{ status: 'done', count: 0 }, 'No new suggestions'], [{ status: 'error', message: 'Boom' }, 'Boom'],
])('label for %o is %s', (state, label) => expect(rowAnalysisLabel(state as RowAnalysisState | undefined)).toBe(label));

it('refuses to start while running or disabled', () => {
  expect(canStartRowAnalysis({ status: 'running' }, null)).toBe(false);
  expect(canStartRowAnalysis(undefined, 'The listing SEO agent is switched off for this workspace.')).toBe(false);
  expect(canStartRowAnalysis({ status: 'done', count: 0 }, null)).toBe(true);
});

it('reports the settings reasons only', () => {
  expect(rowAnalyzeDisabledReason({ settingsLoaded: false, listingSeoEnabled: false })).toBe('Hermes settings are still loading.');
  expect(rowAnalyzeDisabledReason({ settingsLoaded: true, listingSeoEnabled: false })).toBe('The listing SEO agent is switched off for this workspace.');
  expect(rowAnalyzeDisabledReason({ settingsLoaded: true, listingSeoEnabled: true })).toBeNull();
});

it('runs one at a time and stops on 429, keeping finished results', async () => {
  const seen: Array<[string, string]> = [];
  let inFlight = 0;
  const run = async (id: string) => {
    inFlight += 1; expect(inFlight).toBe(1);
    await Promise.resolve(); inFlight -= 1;
    if (id === 'c') throw { status: 429, data: { error: { message: 'Too many AI requests' } } };
    return id === 'a' ? 2 : 0;
  };
  const result = await runSequentially(['a', 'b', 'c', 'd'], run, (id, s) => seen.push([id, s.status]));
  expect(result).toEqual({ analyzed: 2, notRun: ['c', 'd'] });
  expect(seen).toEqual([['a', 'running'], ['a', 'done'], ['b', 'running'], ['b', 'done'], ['c', 'running'], ['c', 'error']]);
});

it('marks a failed product and continues with the next one', async () => {
  const run = async (id: string) => { if (id === 'a') throw new Error('Hermes timeout'); return 1; };
  const states: Record<string, RowAnalysisState> = {};
  const result = await runSequentially(['a', 'b'], run, (id, s) => { states[id] = s; });
  expect(result).toEqual({ analyzed: 1, notRun: [] });
  expect(states.a).toEqual({ status: 'error', message: 'Hermes timeout' });
  expect(states.b).toEqual({ status: 'done', count: 1 });
});
```

And in `ProductsTable.test.tsx`:

```tsx
it('renders the analyze button, result link and disabled reason', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ProductsTable products={[product]} onAnalyze={() => {}}
    analysisByProductId={{ 'p-1': { status: 'done', count: 2 } }} analysisHref={(p) => `/products/${p.id}#suggestions`} /></MemoryRouter>);
  expect(html).toContain('aria-label="Analyze with AI: Wireless Headphones"');
  expect(html).toContain('2 to review');
  expect(html).toContain('href="/products/p-1#suggestions"');
});
it('disables the analyze button while running', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ProductsTable products={[product]} onAnalyze={() => {}}
    analysisByProductId={{ 'p-1': { status: 'running' } }} /></MemoryRouter>);
  expect(html).toMatch(/aria-label="Analyze with AI: Wireless Headphones"[^>]*disabled|disabled[^>]*aria-label="Analyze with AI: Wireless Headphones"/);
});
it('puts Analyze with AI first in the row menu when available', () => {
  const items = productRowMenuItems(product, { onAnalyze: () => {}, onOpen: () => {} }, () => {});
  expect(textContent(items[0])).toContain('Analyze with AI');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend/pages/productsRowAnalysis.test.ts src/frontend/components/tables/ProductsTable.test.tsx`
Expected: FAIL (module missing, no AI cell).

- [ ] **Step 3: Implement** the module per the Interfaces block (error message via the same shape `errorMessage` in `ProductsPage.tsx` reads: `data.error.message`, then `message`, else `Request failed`). In the table's `ai` cell (`data-row-stop`): an `IconButton` with `AutoAwesomeOutlined` icon, `aria-label={`Analyze with AI: ${product.name}`}`, disabled unless `canStartRowAnalysis`, wrapped in a `Tooltip` showing `analyzeDisabledReason` when set; a `CircularProgress size={16}` in place of the icon while running; then the label — a `Link` to `analysisHref(product)` when count ≥ 1, plain secondary text otherwise, error text in `error.main`. Cards get the menu item only.

- [ ] **Step 4: Run to verify they pass** — same command, expected PASS.

- [ ] **Step 5: Commit** — `feat(products): analyze a product with AI from its row`

---

### Task 4: Page wiring — analysis, bulk, tabs, filters gap, copy

**Files:**
- Modify: `src/frontend/pages/ProductsPage.tsx`
- Test: `src/frontend/pages/ProductsPage.test.ts` (only if a pure helper is added here; otherwise covered by Task 5)

**Interfaces:**
- Consumes: Task 1 `visibleProductTabs`, `ProductsTab` incl. `sold`; Task 3 `RowAnalysisState`, `runSequentially`, `rowAnalyzeDisabledReason`, new table props; `useRunHermes`, `productScopedHermesRunInput` (`ListingDetailsPage.tsx`), `useGetHermesSettingsQuery` + `settingsPrincipalKey` (`state/api/settingsApi.ts`, used the same way as `ListingDetailsPage.tsx:702`).

- [ ] **Step 1: Wire row analysis.** State `analysisByProductId: Record<string, RowAnalysisState>`; `analyzeOne(product)` sets `running`, awaits `runHermes(productScopedHermesRunInput(product.id)).unwrap()`, sets `done` with `events.length` or `error`. Pass `onAnalyze`, `analysisByProductId`, `analyzeDisabledReason`, and `analysisHref = (p) => `/products/${p.id}`` to both `ProductsTable` and `ProductsCards`. The state is page-local (leaving the page drops it — spec call).

- [ ] **Step 2: Bulk.** In the selection bar, before Export CSV: `Analyze selected` button (`AutoAwesomeOutlined` icon), disabled while a bulk run is going or `analyzeDisabledReason` is set; shows `Analyzing 3 / 12` while running. It calls `runSequentially([...selectedIds], run, onState)` where `run` returns the event count. On finish: success toast `Analyzed N products.`; when `notRun.length > 0`, warning toast `AI rate limit reached: N products were not analyzed.` and those rows go back to idle (remove their state). Selection stays.

- [ ] **Step 3: Tabs.** Add a Sold count query (`status: ['sold']`, `limit: 1`). Render tabs from `visibleProductTabs(attentionCount.data?.total)` with labels All, Active, Attention, Drafts, Sold. If the URL tab is `attention` while it is hidden, it still filters (the tab is just not shown).

- [ ] **Step 4: Filters gap and copy.** Replace `<Card sx={{ mb: 2 }} contentSx={{ p: 2 }}>` inside `Collapse` with `<Box sx={{ pb: 2 }}><Card contentSx={{ p: 2 }}>…</Card></Box>`. Delete the info `Alert` about marketplace/margin filters (and the `Alert` import if unused). Search placeholder `Search name or OLX id`.

- [ ] **Step 5: Verify** — `npm run lint`, `npm run type-check`, a temporary tsconfig type-check including `src/frontend/**/*.test.*`, and `SKIP_REDIS_TESTS=true npx jest --forceExit src/frontend`. All green.

- [ ] **Step 6: Commit** — `feat(products): wire row and bulk AI analysis, sold tab and filters spacing`

---

### Task 5: Live UI test for the catalogue

**Files:**
- Create: `test-automation/src/main/java/dev/quokkify/marketdesk/page/ProductsPage.java`
- Create: `test-automation/src/main/java/dev/quokkify/marketdesk/step/ProductsPageSteps.java`
- Create: `test-automation/src/main/java/dev/quokkify/marketdesk/verification/ProductsPageVerification.java`
- Create: `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/ProductsCatalogueUiTest.java`
- Modify: `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/BaseUiTest.java` (register `productsPageSteps` like the other steps)

Follow the existing `ProductDetailPage` / `ProductDetailPageSteps` / `ProductDetailPageVerification` trio and `PriceResearchUiTest` setup (`registerNewAccount`, `connectSandboxOlx`, `createOlxProductListing`, sign in, `productsCatalogueIsShown`).

**Interfaces:**
- Produces: `ProductsPageSteps.openFilters()`, `.analyzeRow(String productName)`, `.clickRow(String productName)`, `.verify()`; `ProductsPageVerification.filtersPanelGapAtLeast(int px)`, `.hasColumns(List<String>)`, `.lacksColumns(List<String>)`, `.rowShowsAnalysisResult(String productName)` (text matches `\d+ to review|No new suggestions`), `.isOnProductsPage()`, `.isOnProductPage(String productId)`.

- [ ] **Step 1: Write the tests**

```java
@Test public void catalogueShowsOnlyUsefulColumns() { … verify().hasColumns(List.of("Product", "Status", "Price", "Updated"))
    .lacksColumns(List.of("Markets", "Cost", "Profit", "Tags")); }
@Test public void filtersPanelKeepsItsDistanceFromTheTable() { … openFilters().verify().filtersPanelGapAtLeast(16); }
@Test public void analyzeFromTheRowStaysOnTheCatalogue() { … analyzeRow(name).verify().rowShowsAnalysisResult(name).isOnProductsPage(); }
@Test public void clickingTheRowOpensTheProduct() { … clickRow(name).verify().isOnProductPage(productListing.productId()); }
```

Gap = `table card top − filters panel bottom` via `getBoundingClientRect` in JS, after the Collapse transition (wait for `aria-expanded="true"` and a stable panel height).

- [ ] **Step 2: Run against a stand** — `../scripts/ci-java-api-tests.sh`-style Compose stack built from this branch, then `JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew uiTest --tests '*ProductsCatalogueUiTest'`. Expected: 4 passed. Also run on `origin/main`'s build once to confirm `filtersPanelGapAtLeast(16)` fails there (regression guard for the gap bug).

- [ ] **Step 3: Commit** — `test(ui): products catalogue columns, filters gap, row analyze and row click`
