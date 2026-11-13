# Cut to the Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every MarketDesk surface that does not serve "AI sells a product on autopilot", in four pull requests, without changing the database schema or the core loop.

**Architecture:** Each wave is one branch and one squashed pull request. W0 records the decision in the product contract; W1 deletes backend code with no caller; W2 cuts the frontend shell while backend contracts stay fixed; W3 removes the endpoints that W2 left without a caller. "Delete" removes code, tests, dependencies and documentation; "hide" removes entry points and leaves backend code and stored data in place.

**Tech Stack:** Node 24, TypeScript 6, Express 5, PostgreSQL 18, Redis 8 (Bull), React 19, MUI 9, RTK Query, Vite 8, Jest 30 (swc), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-cut-to-core-design.md`

## Global Constraints

- No wave adds a migration. No table or column is dropped. Stored data is never rewritten.
- These stay exactly as they are: `GET /api/workspaces/:id`; `GET /api/analytics/overview`; domain-event publishing (`eventPublisher`, `RedisEventBroker.publish`); the `MarketplaceKey` union, `MARKETPLACE_KEY_LIST` and `MARKETPLACE_NAMES`; `HermesDecisionEngine.run()` and its tests; `MarketplaceImportService`; `GET` and `PATCH /api/settings/hermes`; the command palette; category reconciliation (mismatch detection in sync, the three `category-correction-operations` routes, `CategoryRecreationReview` on Hermes event cards, product-category sync).
- Core-loop proof. No task may weaken or delete an assertion in: `src/backend/__tests__/e2e/sandboxPublishJourney.e2e.test.ts`; the publish, relist, delete and approve cases of `src/backend/__tests__/e2e/productFlow.e2e.test.ts`; `PublishListingUseCase.test.ts`; `ApproveHermesEventUseCase.test.ts`; `OlxPublicationQuotaService.test.ts`; the `SyncMarketplaceHandler` and `PublishListingHandler` blocks of `jobHandlers.test.ts`; `idor.integration.test.ts`. A task that would have to stops and reports.
- `docs/spec/TRACEABILITY.md` keeps exactly 18 `| §N |` rows. Each row keeps six cells, a status from `Implemented`, `Partial`, `Not implemented`, `Docs only`, a backticked path in the implementation cell, and `#<issue>` in the tracking cell. `npm run verify:spec` enforces this.
- `CHANGELOG-*.md` files are generated. Never edit them.
- The repository is public: no secrets, internal URLs or machine paths in code, docs, commits or pull requests.
- Commits follow Conventional Commits. A pull request that removes a visible feature has `!` in its title.
- Commit locally after each task. Push and open a pull request only when the owner asks.
- Database-gated Jest suites run in CI (`scripts/ci-test.sh`). Do not point them at a shared local PostgreSQL.

## Review Focus

1. A bookmarked link to a removed route or settings section (`/analytics`, `/listings`, `/settings?section=notifications`) shows the not-found page or the General section, never a blank screen. Tests in Tasks 2.1 and 2.3.
2. A stored marketplace row whose key is not `olx` is ignored by the wizard and the Marketplaces page, and connect, publish and sync on it fail with a clear error. Tests in Tasks 1.4, 2.4 and 2.5.
3. A workspace that switched the listing SEO agent off before the cut sees a truthful message on the product page, not an instruction to open a settings section that no longer exists. Test in Task 2.3.
4. A pending Hermes event of a type that only the removed catalogue run produced is still listed and can still be dismissed. Test in Task 3.3.
5. After sign-in the user lands on Products, and no kept screen links to a removed route. Tests in Tasks 2.1 and 2.2.

## Wave gate

Run in this order at the end of every wave; every command must exit 0.

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run verify:spec
npm run experiment:assistance
npm run build
```

Then type-check the test files the wave touched: `tsconfig.json` excludes `*.test.*` and Jest strips types. Use a throwaway tsconfig kept outside the repository that extends the repository `tsconfig.json`, sets `noEmit: true` and `incremental: false`, and includes those test files plus `src/**/*.d.ts`; run `npx tsc -p <that file>`. Expected: no errors in the listed files.

W2 and W3 also run `npm run test:visual` and, on a Compose stand built from the branch, steps 1 to 4 of `docs/TESTING_GUIDE.md` by hand.

## Branches

| Wave | Branch | Pull-request title |
| --- | --- | --- |
| W0 | `docs/cut-to-core` (exists; holds the spec and this plan) | `docs: record the autopilot stage focus` |
| W1 | `refactor/remove-dead-wiring` | `refactor: remove dead wiring and unused dependencies` |
| W2 | `refactor/shell-cut` | `refactor!: cut the shell to the autopilot core` |
| W3 | `refactor/api-follows-ui` | `refactor!: remove endpoints that lost their callers` |

Create each branch from `main` after the previous wave merged. If it has not merged yet, branch from its tip and rebase onto `main` once it has. Before the first edit of a wave run `npm ci` and the wave gate to confirm a green baseline.

---

## Wave 0: stage-focus record

### Task 0.1: Tracking issue and approved deviation

**Files:**
- Modify: `docs/spec/PRODUCT.md`

**Interfaces:**
- Produces: the issue number, written `#444` below. Every later task that edits `TRACEABILITY.md` or `PRODUCT.md` cites it.

- [ ] **Step 1: Show the owner the issue text and wait for approval**

Title: `Stage focus: cut MarketDesk to the autopilot selling core`

```markdown
## Decision

At this stage MarketDesk serves one concept: AI sells a product on autopilot. Surfaces that do
not serve it are removed or hidden. The target concept itself is described in #290.

## Scope

- Delete: code with no caller (notifiers, WebSocket live updates, the `hermes-run` queue, the
  Redis cache, non-OLX adapters, unused dependencies) and the secondary screens (Analytics,
  Dashboard, the Listings page, roadmap channels, notification preferences, the Security,
  API Keys and Telegram settings panels).
- Hide: the Hermes autonomy settings, the catalogue-wide Hermes run, import of existing OLX
  adverts. Their backend code and stored data stay.
- Keep: the product journey, the Hermes feed with approve and dismiss, the OLX publication
  pipeline with its guards, sync, sale recording, category reconciliation.

No schema change. Design: `docs/superpowers/specs/2026-11-13-cut-to-core-design.md`.

## Waves

- [ ] W0 stage-focus record
- [ ] W1 dead wiring
- [ ] W2 shell cut
- [ ] W3 API follows UI
```

- [ ] **Step 2: Create the issue after the owner approves**

Run: `gh issue create --repo quokkify/marketdesk --title "<title>" --body-file <file with the body>`
Expected: a URL ending in the issue number. Record it as `#444`.

- [ ] **Step 3: Amend the source-of-truth hierarchy in `docs/spec/PRODUCT.md`**

Replace the last sentence of item 4 with:
`Maturity limits must be represented honestly in the UI; they do not remove the PRD capability or roadmap surface unless an approved deviation below says so.`

- [ ] **Step 4: Add the deviation row to the "Approved deviations" table**

```markdown
| Stage focus: autopilot selling | At this stage MarketDesk serves one concept: AI sells a product on autopilot. PRD surfaces that do not serve it are removed or hidden until the stage ends. | Removed: Dashboard, the Analytics screen, the Listings page, roadmap marketplace channels, notification preferences, the Security, API Keys and Telegram settings panels, the notifications control and the bulk-action placeholders. Hidden, with backend code and stored data kept: Hermes autonomy settings, the catalogue-wide Hermes run, import of existing OLX adverts. Kept: the product journey, the Hermes feed with approve and dismiss, the OLX publication pipeline and its guards, sale recording. Each surface changes status in `TRACEABILITY.md` in the pull request that removes it. | PRD §6 · §9 · §10 · §12 · §13 · §14 · `docs/superpowers/specs/2026-11-13-cut-to-core-design.md` · #444 |
```

- [ ] **Step 5: Verify**

Run: `npm run verify:spec`
Expected: `Product contract and all 18 PRD traceability rows are complete.`

- [ ] **Step 6: Commit**

```bash
git add docs/spec/PRODUCT.md
git commit -m "docs: record the autopilot stage focus as an approved deviation"
```

---

## Wave 1: dead wiring

No visible change. Every deletion below was confirmed by search at the baseline commit; repeat the search named in each task before deleting.

### Task 1.1: Notifiers and Redis cache

**Files:**
- Delete: `src/backend/infrastructure/external/EmailProvider.ts`, `src/backend/infrastructure/external/TelegramBot.ts`, `src/backend/infrastructure/external/__tests__/notifiers.test.ts`, `src/backend/infrastructure/cache/RedisCache.ts`, `src/backend/infrastructure/cache/__tests__/RedisCache.test.ts`
- Modify: `src/backend/config/di/container.ts` (imports of `createEmailProvider`, `createTelegramBot`, `createRedisCache`, `RedisCache`; the two notifier calls; `const cache`; the `cache` field of the container type and return value), `src/backend/infrastructure/eventBroker/RedisWiring.ts` (`createRedisCache`)
- Test: `src/backend/config/di/__tests__/container.test.ts`

- [ ] **Step 1: Change the lifecycle test to the new contract**

In `exposes lifecycle handles and a resolving shutdown()` replace `expect(container.cache).toBeDefined();` with:

```ts
expect('cache' in container).toBe(false);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/backend/config/di/__tests__/container.test.ts -t "lifecycle handles"`
Expected: FAIL, `expected false, received true`.

- [ ] **Step 3: Confirm there is no other reader**

Run: `grep -rnE "EmailProvider|TelegramBot|RedisCache|createRedisCache|container\.cache" src --include='*.ts'`
Expected: only the files listed above.

- [ ] **Step 4: Delete the five files and the wiring listed under Files**

- [ ] **Step 5: Verify**

Run: `npm run type-check && npx jest src/backend/config src/backend/infrastructure`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/backend
git commit -m "refactor: remove unused notifiers and redis cache"
```

### Task 1.2: WebSocket live updates and the subscriber port

**Files:**
- Delete: `src/backend/presentation/websocket/HermesLiveUpdates.ts`, `src/backend/presentation/__tests__/HermesLiveUpdates.test.ts`
- Modify: `src/backend/main.ts` (import, the three attach lines, `await hermesLive.close()`), `src/backend/config/di/container.ts` (`IEventSubscriber` import, `subscriber` field and return value), `src/backend/infrastructure/eventBroker/RedisEventBroker.ts` (`EventSubscriber`, `subscribers`, `subscribe`, `notify`, and the `this.notify(event)` call in `publish`), `package.json` (`ws`, `@types/ws`)
- Test: `src/backend/config/di/__tests__/container.test.ts`

**Interfaces:**
- Produces: `RedisEventBroker implements EventBroker` only; `publish(event: DomainEvent): Promise<string>` is unchanged.

- [ ] **Step 1: Replace the subscriber test**

Replace `exposes a functioning WS event subscriber fed by the broker` with:

```ts
it('exposes no in-process event subscriber', () => {
  expect('subscriber' in build()).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/backend/config/di/__tests__/container.test.ts -t "no in-process event subscriber"`
Expected: FAIL.

- [ ] **Step 3: Confirm there is no client and no other subscriber**

Run: `grep -rnE "hermes/live|WebSocket|\.subscribe\(" src tests --include='*.ts' --include='*.tsx'`
Expected: hits only in the files listed above.

- [ ] **Step 4: Delete the files and edit the modules listed under Files; run `npm install` to update the lockfile**

- [ ] **Step 5: Verify**

Run: `npm run type-check && npx jest src/backend/config src/backend/infrastructure/eventBroker src/backend/__tests__`
Expected: PASS. Any boot test that asserted the "Hermes live WebSocket attached" log line loses that assertion.

- [ ] **Step 6: Commit**

```bash
git add -A src/backend package.json package-lock.json
git commit -m "refactor: remove the websocket live updates nobody connects to"
```

### Task 1.3: `hermes-run` queue

**Files:**
- Delete: `src/backend/infrastructure/jobQueue/JobHandlers/HermesRunHandler.ts`
- Modify: `src/backend/config/di/container.ts` (`HermesRunHandler` and `HermesRunJob` imports, `hermesQueue`, `hermesEnginePort`, `hermesHandler`, the handler registration, the `queues` array), `src/backend/application/ports/IJobQueue.ts` (`HermesRunJob`), `src/backend/infrastructure/jobQueue/__tests__/jobHandlers.test.ts` (the `describe('HermesRunHandler'` block and its import)
- Test: `src/backend/config/di/__tests__/container.test.ts`

- [ ] **Step 1: Replace the Hermes-run handler test and tighten the lifecycle test**

Delete `propagates a Hermes-run failure through the job handler (C2)`. Add:

```ts
it('creates exactly the publish and sync queues', () => {
  const names: string[] = [];
  buildContainer({
    pool: fakePool,
    redis: fakeRedis,
    aiProvider: fakeAi,
    idGenerator: () => 'fixed-id',
    marketplaceCredentialsKey: validCredentialsKey,
    createQueue: <T>(name: string): ManagedQueue<T> => {
      names.push(name);
      return {
        enqueue: jest.fn(async () => undefined),
        enqueueAll: jest.fn(async () => undefined),
        scheduleRepeat: jest.fn(async () => undefined),
        removeRepeat: jest.fn(async () => undefined),
        registerHandler: jest.fn(),
        close: jest.fn(async () => undefined),
      };
    },
  });
  expect(names).toEqual(['publish-listing', 'sync-marketplace']);
});
```

In the lifecycle test change `toHaveLength(3)` to `toHaveLength(2)`.

- [ ] **Step 2: Run and watch both fail**

Run: `npx jest src/backend/config/di/__tests__/container.test.ts`
Expected: FAIL on the two changed tests.

- [ ] **Step 3: Confirm the queue has no producer**

Run: `grep -rnE "\.(enqueue|enqueueAll|scheduleRepeat)\(" src/backend --include='*.ts'`
Expected: outside tests and testkits, calls only on the publish and sync queues.

- [ ] **Step 4: Delete the handler and the wiring listed under Files**

`RunHermesUseCase` stays: the product-scoped run uses it. Keys left in Redis under `bull:hermes-run:*` are never read again and need no cleanup.

- [ ] **Step 5: Verify**

Run: `npm run type-check && npx jest src/backend/config src/backend/infrastructure/jobQueue`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/backend
git commit -m "refactor: remove the hermes-run queue that has no producer"
```

### Task 1.4: Non-OLX adapters and the connect guard

**Files:**
- Delete: `src/backend/infrastructure/adapters/AllegroAdapter.ts`, `VintedAdapter.ts`, `FacebookAdapter.ts`, `EbayAdapter.ts` (same directory)
- Modify: `src/backend/infrastructure/adapters/MarketplaceAdapterFactory.ts` (the four imports and `register` calls, the header comment), `src/backend/presentation/http/controllers/MarketplaceController.ts` (`update`), `src/backend/domain/services/MarketplaceAdapter.ts` (header comment)
- Test: `src/backend/infrastructure/adapters/__tests__/MarketplaceAdapterFactory.test.ts`, `src/backend/presentation/__tests__/api.integration.test.ts`

- [ ] **Step 1: Rewrite the factory test**

```ts
import { MarketplaceAdapterFactory } from '../MarketplaceAdapterFactory';
import { OLXAdapter } from '../OLXAdapter';
import { MarketplaceNotImplementedError } from '../MarketplaceError';

describe('MarketplaceAdapterFactory', () => {
  const factory = new MarketplaceAdapterFactory();

  it('creates the OLX adapter', () => {
    const adapter = factory.create('olx');
    expect(adapter).toBeInstanceOf(OLXAdapter);
    expect(adapter.getKey()).toBe('olx');
  });

  it.each(['allegro', 'vinted', 'facebook', 'ebay', 'etsy', 'amazon'] as const)(
    'fails closed for %s',
    (key) => {
      expect(factory.isSupported(key)).toBe(false);
      expect(() => factory.create(key)).toThrow(MarketplaceNotImplementedError);
    },
  );
});
```

- [ ] **Step 2: Add the connect-guard test to the `marketplace OAuth` block of `api.integration.test.ts`**

```ts
it('refuses to connect a marketplace other than OLX', async () => {
  const { app, marketplaceRepo } = await buildTestApp();
  const allegro = Marketplace.create({
    id: 'marketplace-allegro',
    workspaceId: 'ws-1',
    key: 'allegro',
    name: 'Allegro',
    connected: false,
    syncMode: 'manual',
  });
  if (allegro.isErr()) throw allegro.error;
  await marketplaceRepo.save(allegro.value);

  const res = await auth(request(app).patch('/api/marketplaces/marketplace-allegro')).send({
    connected: true,
  });

  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('INVALID_STATE');
  expect(res.body.error.message).toBe('Only OLX can be connected');
  expect((await marketplaceRepo.findById('marketplace-allegro'))?.isConnected()).toBe(false);
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `npx jest src/backend/infrastructure/adapters/__tests__/MarketplaceAdapterFactory.test.ts src/backend/presentation/__tests__/api.integration.test.ts -t "fails closed|refuses to connect"`
Expected: FAIL.

- [ ] **Step 4: Delete the four adapters and their registrations**

- [ ] **Step 5: Guard `MarketplaceController.update`**

When `req.body.connected === true` and `marketplace.key !== 'olx'`, return `next(new InvalidStateError('Only OLX can be connected'))` before `marketplace.connect()`.

- [ ] **Step 6: Verify**

Run: `npm run type-check && npx jest src/backend/infrastructure/adapters src/backend/presentation`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/backend
git commit -m "refactor: remove non-OLX adapters and refuse to connect other marketplaces"
```

### Task 1.5: Unused dependencies and configuration keys

**Files:**
- Modify: `package.json`, `package-lock.json`, `vite.config.ts` (the `query` entry of `manualChunks`), `src/backend/config/env.ts` (the `rateLimit`, `timezone` and `features` entries), `src/backend/config/__tests__/env.test.ts`, `.env.example`

- [ ] **Step 1: Confirm each package has no import**

Run once per package from `axios`, `passport`, `passport-jwt`, `redis`, `uuid`, `date-fns`, `joi`, `@tanstack/react-query`, `docker-compose`:
`grep -rnE "['\"]<package>['\"/]" src scripts tests vite.config.ts jest.config.js eslint.config.js playwright.config.ts`
Expected: no hit, except `@tanstack/react-query` in `vite.config.ts`. A package with any other hit stays.

- [ ] **Step 2: Remove them**

Run: `npm uninstall axios passport passport-jwt redis uuid date-fns joi @tanstack/react-query @types/uuid docker-compose`
Then delete the `query: ['@tanstack/react-query'],` line in `vite.config.ts`.

- [ ] **Step 3: Remove the configuration entries that nothing reads**

Run: `grep -rnE "env\.(rateLimit|timezone|features)" src`
Expected: no hit. Then delete the `rateLimit`, `timezone` and `features` entries of the `env` object in `src/backend/config/env.ts`, their assertions in `env.test.ts`, and from `.env.example` every variable that only those three entries read. If the search finds a reader, that entry stays.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run build && npx jest src/backend/config`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/backend/config .env.example
git commit -m "chore: remove dependencies and configuration keys that nothing reads"
```

### Task 1.6: Wave 1 documents and gate

**Files:**
- Modify: `ARCHITECTURE.md` (the passages that describe WebSocket live updates, the notification system, the Redis cache and the Allegro, Vinted, Facebook and eBay adapters as present)

- [ ] **Step 1: Find the passages**

Run: `grep -nE "WebSocket|hermes/live|EmailProvider|TelegramBot|RedisCache|Allegro|Vinted|Facebook|eBay|hermes-run" ARCHITECTURE.md`

- [ ] **Step 2: Rewrite each hit so it states what the code does now**

A removed component is described as removed in the stage-focus cut (#444), not as running.

- [ ] **Step 3: Run the wave gate**

Expected: every command exits 0.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: align the architecture document with the removed wiring"
```

---

## Wave 2: shell cut

Frontend only. No file under `src/backend` changes in this wave.

### Task 2.1: Routes, navigation and the three removed pages

**Files:**
- Delete: `src/frontend/pages/DashboardPage.tsx`, `DashboardPage.test.tsx`, `dashboardPresentation.ts`, `dashboardPresentation.test.ts`, `AnalyticsPage.tsx`, `AnalyticsPage.test.tsx`, `ListingsPage.tsx`, `ListingsPage.test.tsx` (all in `src/frontend/pages`); `src/frontend/components/charts/` (whole directory); `src/frontend/components/tables/AnalyticsTable.tsx`
- Modify: `src/frontend/App.tsx`, `src/frontend/utils/constants.ts` (`APP_ROUTE_PATHS`, `NAV_ITEMS`), `src/frontend/components/layout/TopBar.tsx` (route title map), `src/frontend/components/tables/index.ts`, `src/frontend/services/hooks/index.ts` (`useAnalyticsRevenue`, `useAnalyticsListings`), `src/frontend/state/api/analyticsApi.ts` (the revenue and listings endpoints), `package.json` (`recharts`), `vite.config.ts` (the `charts` chunk)
- Test: `src/frontend/App.routes.test.tsx`, `src/frontend/components/layout/TopBar.test.tsx`, `src/frontend/components/layout/Sidebar.test.tsx`, `src/frontend/services/hooks/index.test.ts`

**Interfaces:**
- Produces: `APP_ROUTE_PATHS` without `analytics` and `listings`; `NAV_ITEMS` paths `['/products', '/hermes', '/marketplaces', '/settings']`; `useAnalyticsOverview` unchanged.

- [ ] **Step 1: Add route tests to `App.routes.test.tsx`**

```ts
import { Navigate } from 'react-router-dom';

const shellRoutes = () =>
  findRoute(routes, (route) => React.isValidElement(route.element) && route.element.type === AppShell)
    ?.children ?? [];

it('sends the index route to Products', () => {
  const index = shellRoutes().find((route) => route.index);
  expect(React.isValidElement(index?.element) && index.element.type === Navigate).toBe(true);
  expect((index?.element as React.ReactElement<{ to: string; replace?: boolean }>).props).toMatchObject({
    to: '/products',
    replace: true,
  });
});

it('has no Dashboard, Analytics or Listings route and keeps the not-found fallback', () => {
  const paths = shellRoutes()
    .filter((route) => !route.index)
    .map((route) => route.path);
  expect(paths).toEqual(['/products', '/products/:productId', '/hermes', '/marketplaces', '/settings', '*']);
});
```

- [ ] **Step 2: Replace `keeps Listings routable but out of primary PRD navigation` in `TopBar.test.tsx`**

```ts
it('lists the four stage-focus destinations', () => {
  expect(NAV_ITEMS.map(({ path }) => path)).toEqual(['/products', '/hermes', '/marketplaces', '/settings']);
  expect(Object.values(APP_ROUTE_PATHS)).not.toContain('/analytics');
  expect(Object.values(APP_ROUTE_PATHS)).not.toContain('/listings');
});
```

Remove `/`, `/listings` and `/analytics` from the title table of that file; `/` now resolves to the fallback title.

- [ ] **Step 3: Run and watch them fail**

Run: `npx jest src/frontend/App.routes.test.tsx src/frontend/components/layout/TopBar.test.tsx`
Expected: FAIL on the new tests.

- [ ] **Step 4: Edit `App.tsx`**

The index route becomes `<Route index element={<Navigate to={APP_ROUTE_PATHS.products} replace />} />`. Remove the three lazy imports and the Listings and Analytics routes.

- [ ] **Step 5: Edit the modules and delete the files listed under Files**

In `Sidebar.test.tsx` delete `does not mark Dashboard active for unrelated routes`; no navigation item has the path `/` any more. In `services/hooks/index.test.ts` drop the revenue and listings cases. In `preloadErrorRecovery.test.ts` the fixture asset name `AnalyticsPage-newest.js` becomes `ProductsPage-newest.js`.

- [ ] **Step 6: Remove `recharts`**

Run: `grep -rn "recharts" src` (expected: no hit), then `npm uninstall recharts` and delete the `charts` line of `manualChunks`.

- [ ] **Step 7: Verify**

Run: `npm run type-check && npm run lint && npx jest src/frontend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/frontend package.json package-lock.json vite.config.ts
git commit -m "refactor!: remove the dashboard, analytics and listings screens"
```

### Task 2.2: Top bar, bulk buttons, the sync-issues link and the unused workspace hook

**Files:**
- Modify: `src/frontend/components/layout/TopBar.tsx` (the disabled notifications control and its icon import), `src/frontend/pages/ProductsPage.tsx` (the three disabled bulk buttons and their explanatory line), `src/frontend/components/marketplaces/MarketplaceCard.tsx` (`SYNC_ISSUES_PATH` and the "Review sync issues" link), `src/frontend/services/hooks/index.ts` (`useUpdateWorkspace`), `src/frontend/state/api/workspacesApi.ts` (the `updateWorkspace` endpoint and its hook)
- Test: `src/frontend/components/layout/TopBar.test.tsx`, `src/frontend/components/marketplaces/MarketplaceCard.test.tsx`

- [ ] **Step 1: Replace `keeps notifications visibly unavailable` in `TopBar.test.tsx`**

```ts
it('has no notifications control', () => {
  expect(html).not.toContain('Notifications');
});
```

Rename `renders the theme and notification controls as bordered 36px squares` to `renders the theme control as a bordered 36px square`; its assertions stay.

- [ ] **Step 2: Replace `counts sync errors and links them to the listings error filter` in `MarketplaceCard.test.tsx`**

```ts
it('counts sync errors without linking to a removed page', () => {
  const html = renderHtml(<MarketplaceCard {...cardProps({ errorCount: 2 })} />);

  expect(html).toContain('>2 errors</dd>');
  expect(html).not.toContain('href="/listings');
  expect(html).not.toContain('Review sync issues');
});
```

Remove the `SYNC_ISSUES_PATH` import.

- [ ] **Step 3: Run and watch them fail**

Run: `npx jest src/frontend/components/layout/TopBar.test.tsx src/frontend/components/marketplaces/MarketplaceCard.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Edit the components**

On the card the error count stays and the "Review sync issues" link goes; delete `SYNC_ISSUES_PATH`. In `ProductsPage.tsx` keep Export CSV and delete Add tag, Edit price, Delete and the "not available yet" line.

- [ ] **Step 5: Remove the workspace update hook**

Run: `grep -rnE "useUpdateWorkspace\b|useUpdateWorkspaceMutation" src/frontend`
Expected: hits only in `services/hooks/index.ts` and `state/api/workspacesApi.ts`. Delete the hook and the endpoint. `useWorkspace` and `GET /workspaces/:id` stay: sign-in uses them.

- [ ] **Step 6: Verify**

Run: `npm run type-check && npm run lint && npx jest src/frontend/components src/frontend/pages/ProductsPage.test.ts src/frontend/services`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/frontend
git commit -m "refactor!: remove the disabled notifications bell and bulk buttons"
```

### Task 2.3: Settings sections

**Files:**
- Modify: `src/frontend/pages/SettingsPage.tsx` (`SettingsSection`, `settingsSections`, the Hermes AI, Notifications, API Keys, Telegram and Security panels, `RoadmapPanel`, the roadmap rows of the Marketplace Accounts panel, the notification queries), `src/frontend/state/api/settingsApi.ts` (notification endpoints, hooks and patch helper; the Hermes settings mutation hook), `src/frontend/pages/HermesActivityPage.tsx` (`HERMES_SETTINGS_PATH`, the `onConfigure` prop and the Configure button of the page header), `src/frontend/pages/ListingDetailsPage.tsx` (the third message of `productHermesDisabledReason`)
- Test: `src/frontend/pages/SettingsPage.test.tsx`, `SettingsPage.render.test.tsx`, `HermesActivityPage.test.tsx`, `ListingDetailsPage.test.tsx`

**Interfaces:**
- Produces: `type SettingsSection = 'general' | 'marketplaces' | 'appearance' | 'about'`; `useGetHermesSettingsQuery` unchanged (the product page reads it).

- [ ] **Step 1: Rewrite the section tests in `SettingsPage.test.tsx`**

```ts
it('offers four sections', () => {
  expect(settingsSections.map((section) => section.id)).toEqual([
    'general',
    'marketplaces',
    'appearance',
    'about',
  ]);
});

it.each(['hermes', 'notifications', 'apiKeys', 'telegram', 'security'])(
  'opens General for the removed section %s',
  (section) => {
    expect(settingsSectionFromLocation({ search: `?section=${section}`, hash: '' })).toBe('general');
    expect(settingsSectionFromHash(`#${section}`)).toBe('general');
  },
);
```

In the existing location tests replace removed ids with `marketplaces` and `appearance`. Delete the `Security panel`, `Roadmap panel` and `Notifications section copy` blocks. Rewrite `lists roadmap channels as unavailable without status or manage controls` as `lists no roadmap channel`: the same render call, asserting that the text contains none of `Allegro`, `Vinted`, `Facebook`, `eBay`, `Etsy`, `Amazon`, `Roadmap`. In `SettingsPage.render.test.tsx` delete the Hermes and Notifications render cases and the notification fixtures.

- [ ] **Step 2: Change the disabled-agent expectation in `ListingDetailsPage.test.tsx`**

In `keeps the product Hermes action disabled until settings allow listing SEO`, the case with `settingsLoaded: true, listingSeoEnabled: false` expects:

```ts
).toBe('The listing SEO agent is switched off for this workspace.');
```

- [ ] **Step 3: Change the two Configure tests in `HermesActivityPage.test.tsx`**

In `renders the Hermes AI identity on the companion gradient with a real Configure target` replace the `HERMES_SETTINGS_PATH` and `Configure` assertions with `expect(html).not.toContain('Configure');` and drop "with a real Configure target" from the name. In `wires Configure and product selection to the callbacks it is given` remove `onConfigure` and its assertions and rename the test `wires product selection to the callback it is given`. Remove the `HERMES_SETTINGS_PATH` import.

- [ ] **Step 4: Run and watch them fail**

Run: `npx jest src/frontend/pages/SettingsPage.test.tsx src/frontend/pages/ListingDetailsPage.test.tsx src/frontend/pages/HermesActivityPage.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Edit the modules listed under Files**

`settingsSectionFromLocation` and `settingsSectionFromHash` already fall back to `general` for unknown ids; narrowing `SettingsSection` is what makes the removed ids unknown. The third message of `productHermesDisabledReason` becomes `The listing SEO agent is switched off for this workspace.` Delete components, hooks and types that lose their last use; ESLint's `no-unused-vars` names them.

- [ ] **Step 6: Verify**

Run: `npm run type-check && npm run lint && npx jest src/frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/frontend
git commit -m "refactor!: reduce settings to general, marketplace accounts, appearance and about"
```

### Task 2.4: Marketplaces page

**Files:**
- Delete: `src/frontend/components/marketplaces/RoadmapMarketplaceCard.tsx`, `MarketplaceSummaryBar.tsx`, `MarketplaceSummaryBar.test.tsx`
- Modify: `src/frontend/pages/MarketplacesPage.tsx` (roadmap grid, summary bar, import panel and its state), `src/frontend/state/api/marketplacesApi.ts` (the two import endpoints and hooks), `src/frontend/services/hooks/index.ts` (`useImportMarketplacePreview`, `useImportMarketplaceAdverts`)
- Test: `src/frontend/pages/MarketplacesPage.test.tsx`

- [ ] **Step 1: Replace the two roadmap tests**

```ts
it('renders the OLX card and nothing else', () => {
  const html = renderPage();

  expect(count(html, '<section')).toBe(1);
  expect(count(html, 'aria-label="OLX logo"')).toBe(1);
  expect(html).not.toContain('Not available yet');
  expect(html).not.toContain('marketplaces connected');
  expect(html).not.toContain('Import');
});

it('ignores a stored marketplace that is not OLX', () => {
  setup({
    marketplaces: [
      olx(),
      { ...olx(), id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true },
    ],
  });
  const html = renderPage();

  expect(count(html, '<section')).toBe(1);
  expect(html).not.toContain('Allegro');
});
```

Remove the `ROADMAP_CARD_COPY` import, `ROADMAP_NAMES`, the import-hook mocks and `mockCapture.summary`. In the two tests named `…and keeps the roadmap visible` drop the roadmap assertion and that suffix. Rename `shows workspace and OLX live listing counts from analytics` to `shows the OLX live listing count from analytics` and keep only its OLX card assertion: the card still reads the overview, the summary bar is gone.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest src/frontend/pages/MarketplacesPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Edit the page and delete the files listed under Files**

The page renders a card only for the marketplace whose key is `olx`.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx jest src/frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/frontend
git commit -m "refactor!: show only OLX on the marketplaces page"
```

### Task 2.5: Product wizard marketplace step

**Files:**
- Modify: `src/frontend/components/forms/ProductWizardForm.tsx` (`MARKETPLACE_OPTIONS`, the "Not available yet" and "Roadmap channel" branches)
- Test: `src/frontend/components/forms/ProductWizardForm.test.tsx`

**Interfaces:**
- Produces: `buildWizardMarketplaceOptions(marketplaces)` returns one option, for `olx`, whatever rows it receives.

- [ ] **Step 1: Rewrite `enables only connections reported as connected by the API`**

```ts
it('offers OLX only and ignores other stored marketplaces', () => {
  const options = buildWizardMarketplaceOptions([
    marketplace(),
    marketplace({ id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true }),
  ]);

  expect(options.map((option) => option.key)).toEqual(['olx']);
  expect(options[0]).toMatchObject({ configured: true, connected: true, integrated: true });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest src/frontend/components/forms/ProductWizardForm.test.tsx -t "offers OLX only"`
Expected: FAIL, received seven keys.

- [ ] **Step 3: Reduce `MARKETPLACE_OPTIONS` to the OLX entry and delete the branches that only roadmap channels reached**

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx jest src/frontend/components/forms`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/frontend
git commit -m "refactor!: list only OLX in the product wizard"
```

### Task 2.6: Wave 2 documents and gate

**Files:**
- Modify: `docs/spec/TRACEABILITY.md`, `docs/spec/PRODUCT.md`, `README.md`, `docs/TESTING_GUIDE.md`

- [ ] **Step 1: Re-status the traceability rows**

| Row | Status | Must say |
| --- | --- | --- |
| §4 Information architecture | Partial | four destinations; `src/frontend/utils/constants.ts`; `TopBar.test.tsx`; #444 |
| §6 Dashboard | Not implemented | removed for the stage focus; `src/frontend/App.tsx` redirects `/` to `/products`; `App.routes.test.tsx`; #444 |
| §9 Analytics | Not implemented | screen removed, sale recording kept; `src/backend/config/di/container.ts`; `App.routes.test.tsx`; #444 |
| §12 Marketplaces | Partial | OLX only, roadmap channels and import entry removed; `MarketplacesPage.test.tsx`; #444 |
| §13 Settings | Partial | four sections; `SettingsPage.test.tsx`; #444 |
| §14 Global interactions | Partial | notifications control and bulk placeholders removed; `TopBar.test.tsx`; #444 |

Update the "Screen acceptance map" in the same file: delete the Dashboard and Analytics lines.

- [ ] **Step 2: Update the approved deviations in `PRODUCT.md`**

The "Marketplace availability" row no longer promises roadmap cards. The "Settings: Security, API keys, Telegram, notification delivery" row says those panels and the notification matrix are removed under the stage-focus deviation.

- [ ] **Step 3: Update `README.md` and `docs/TESTING_GUIDE.md`**

No sentence may describe the Dashboard, the Analytics page, the Listings page, roadmap cards, notification preferences or the import action as present. Step 5 of the tester journey is deleted, and the limitations table loses the rows for removed surfaces.

- [ ] **Step 4: Run the wave gate, `npm run test:visual`, and the manual journey**

Expected: every command exits 0; steps 1 to 4 of the tester guide pass on a Compose stand built from the branch.

- [ ] **Step 5: Commit**

```bash
git add docs README.md
git commit -m "docs: restate the product contract after the shell cut"
```

---

## Wave 3: API follows UI

Each removed route answers with the standard 404 envelope that the `unmatched routes` block of `api.integration.test.ts` already asserts.

### Task 3.1: Notification preferences and the integrations list

**Files:**
- Modify: `src/backend/presentation/http/routes/settings.ts` (the two `/notifications` routes), `src/backend/presentation/http/controllers/SettingsController.ts` (`getNotifications`, `updateNotifications`, the Telegram and API-key items of `getIntegrations`), `src/backend/presentation/http/validation/schemas.ts` (the notification schema), `src/backend/application/ports/ISettingsRepository.ts` (`getNotificationPreferences`, `updateNotificationPreferences`, `getApiKeySummary`), `src/backend/infrastructure/persistence/repositories/SettingsRepository.ts`, `InMemorySettingsRepository.ts`, `src/shared/types/settings.ts` (types that lose their last use)
- Test: `src/backend/presentation/__tests__/api.integration.test.ts`, `src/backend/presentation/http/controllers/__tests__/SettingsController.test.ts`, `src/backend/infrastructure/persistence/repositories/__tests__/SettingsRepository.test.ts`, `SettingsRepository.postgres.integration.test.ts`

**Interfaces:**
- Produces: `GET /api/settings/integrations` returns `{ items }` where every item has `category: 'marketplace'`.

- [ ] **Step 1: Add to the `persistent settings contracts` block of `api.integration.test.ts`**

```ts
it.each([
  ['get', '/api/settings/notifications'],
  ['patch', '/api/settings/notifications'],
] as const)('no longer serves %s %s', async (method, path) => {
  const { app } = await buildTestApp();
  const res = await auth(request(app)[method](path)).send({});
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
});

it('lists only marketplace integrations', async () => {
  const { app } = await buildTestApp();
  const res = await auth(request(app).get('/api/settings/integrations'));
  expect(res.status).toBe(200);
  expect(res.body.data.items.map((item: { category: string }) => item.category)).toEqual([
    'marketplace',
  ]);
});
```

Remove the `PATCH /api/settings/notifications` call and its assertions from the existing persistence test in that block, and the Telegram and API-key expectations from its existing integrations case.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest src/backend/presentation/__tests__/api.integration.test.ts -t "no longer serves|only marketplace integrations"`
Expected: FAIL.

- [ ] **Step 3: Remove the routes, controller methods, schema, port methods and both repository implementations**

Delete the unit and Postgres integration cases that covered the removed repository methods. The `notification_preferences` and `api_keys` tables stay.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx jest src/backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor!: remove the notification preferences endpoints"
```

### Task 3.2: Analytics read endpoints

**Files:**
- Modify: `src/backend/presentation/http/routes/analytics.ts` (`/revenue`, `/listings`), `src/backend/presentation/http/controllers/AnalyticsController.ts` (`revenue`, `listings`), `src/backend/application/services/AnalyticsApplicationService.ts` (`getRevenue`, `getListingPerformance`, `RevenuePoint`, `ListingPerformance`)
- Test: `src/backend/presentation/__tests__/api.integration.test.ts`, `src/backend/presentation/http/controllers/__tests__/AnalyticsController.test.ts`, `src/backend/application/__tests__/AnalyticsApplicationService.test.ts`

- [ ] **Step 1: Add an `analytics` block to `api.integration.test.ts`**

```ts
describe('analytics', () => {
  it.each(['/api/analytics/revenue', '/api/analytics/listings'])('no longer serves %s', async (path) => {
    const { app } = await buildTestApp();
    const res = await auth(request(app).get(path));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('still serves the overview', async () => {
    const { app } = await buildTestApp();
    const res = await auth(request(app).get('/api/analytics/overview'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch the first test fail**

Run: `npx jest src/backend/presentation/__tests__/api.integration.test.ts -t "analytics"`
Expected: `no longer serves` FAILS with 200; `still serves the overview` PASSES.

- [ ] **Step 3: Remove the two routes, the two controller methods, the two service methods and their types; delete their unit cases**

`getDashboardMetrics` and the analytics event repository stay. Drop the removed methods from the analytics service stub at the top of `api.integration.test.ts`.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx jest src/backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/backend
git commit -m "refactor!: remove the analytics revenue and listings endpoints"
```

### Task 3.3: Legacy catalogue-wide Hermes run

**Files:**
- Modify: `src/backend/presentation/http/routes/hermes.ts` (`POST /run`), `src/backend/presentation/http/controllers/HermesController.ts` (`run`), `src/backend/presentation/http/validation/schemas.ts` (`runHermesSchema`), `src/backend/application/dto/HermesDTO.ts` (`RunHermesDTO.productId` becomes required), `src/backend/application/usecases/RunHermesUseCase.ts`, `docs/marketdesk-agents.md` (the sentence about the legacy endpoint)
- Test: `src/backend/__tests__/e2e/productFlow.e2e.test.ts`, `src/backend/application/__tests__/RunHermesUseCase.test.ts`

**Interfaces:**
- Produces: `RunHermesDTO.productId: string` (required; the other fields are unchanged); `RunHermesUseCase.execute` always calls `engine.runProductSeo(workspace, input.productId)`.

- [ ] **Step 1: Replace `runs Hermes for the workspace (endpoint returns 202)` in `productFlow.e2e.test.ts`**

```ts
it('no longer serves the catalogue-wide Hermes run', async () => {
  const { app } = await buildE2E();
  const token = await login(app);

  const run = await request(app)
    .post('/api/hermes/run')
    .set('Authorization', `Bearer ${token}`)
    .send({ trigger: 'manual' });

  expect(run.status).toBe(404);
  expect(run.body.error.code).toBe('NOT_FOUND');
});
```

This case is not part of the core-loop proof; the approve case after it is, and stays untouched.

- [ ] **Step 2: Add the stored-event test after it in the same file**

```ts
it('still lists and dismisses a stored event that only the removed run produced', async () => {
  const { app, eventRepo } = await buildE2E();
  const token = await login(app);
  const event = unwrap(
    HermesEvent.create({
      id: 'evt-e2e-price',
      workspaceId: WORKSPACE_ID,
      productId: null,
      type: 'suggested_lower_price',
      severity: 'info',
      title: 'Lower the price',
      proposedChange: { kind: 'price', field: 'price', from: 20, to: 18 },
    })
  );
  await eventRepo.save(event);

  const list = await request(app)
    .get('/api/hermes/events')
    .set('Authorization', `Bearer ${token}`);
  expect(list.status).toBe(200);
  expect(list.body.data.map((item: { id: string }) => item.id)).toContain('evt-e2e-price');

  const dismiss = await request(app)
    .post('/api/hermes/events/evt-e2e-price/dismiss')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(dismiss.status).toBe(200);
  expect(dismiss.body.data.status).toBe('dismissed');
});
```

Expected before and after the change: PASS. It pins behaviour the removal must not break.

- [ ] **Step 3: Run and watch the e2e test fail**

Run: `npx jest src/backend/__tests__/e2e/productFlow.e2e.test.ts -t "catalogue-wide"`
Expected: FAIL with 202.

- [ ] **Step 4: Remove the route, `HermesController.run` and `runHermesSchema`; make `productId` required and drop the `engine.run` branch of the use case**

In `RunHermesUseCase.test.ts` delete the cases without `productId`. `HermesDecisionEngine.run()` and `HermesDecisionEngine.test.ts` are not touched.

- [ ] **Step 5: Verify**

Run: `npm run type-check && npm run lint && npx jest src/backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/backend docs/marketdesk-agents.md
git commit -m "refactor!: remove the catalogue-wide hermes run endpoint"
```

### Task 3.4: Import routes

**Files:**
- Modify: `src/backend/presentation/http/routes/marketplaces.ts` (`/:id/import-preview`, `/:id/import`), `src/backend/presentation/http/controllers/MarketplaceController.ts` (`importPreview`, `importApply`, and constructor dependencies only they used)
- Test: `src/backend/presentation/__tests__/api.integration.test.ts`

- [ ] **Step 1: Replace the import cases of the `marketplace OAuth` block**

```ts
it.each(['import-preview', 'import'])('no longer serves POST %s', async (action) => {
  const { app } = await buildTestApp();
  const res = await auth(request(app).post(`/api/marketplaces/marketplace-olx/${action}`)).send({});
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
});
```

Delete the three existing import cases (preview, apply, and the `it.each` over both routes).

- [ ] **Step 2: Run and watch it fail**

Run: `npx jest src/backend/presentation/__tests__/api.integration.test.ts -t "no longer serves POST"`
Expected: FAIL.

- [ ] **Step 3: Remove the two routes and the two controller methods**

`MarketplaceImportService`, its tests and its wiring into sync (`recommendSyncedCategoryMismatch`) stay.

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm run lint && npx jest src/backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/backend
git commit -m "refactor!: unmount the import routes"
```

### Task 3.5: Wave 3 documents and gate

**Files:**
- Modify: `docs/spec/TRACEABILITY.md`, `docs/spec/PRODUCT.md`, `docs/olx-import-foundation.md`, `docs/TESTING_GUIDE.md`, `ARCHITECTURE.md`

- [ ] **Step 1: Update the traceability rows**

| Row | Status | Must say |
| --- | --- | --- |
| §9 Analytics | Not implemented | revenue and listings endpoints removed, overview and sale recording kept; `src/backend/presentation/http/routes/analytics.ts`; `api.integration.test.ts`; #444 |
| §10 Hermes AI overview | Partial | product-scoped analysis only, catalogue-wide run endpoint removed; `src/backend/presentation/http/routes/hermes.ts`; `productFlow.e2e.test.ts`; #444 |
| §13 Settings | Partial | notification endpoints removed, Hermes settings API kept without a screen; `SettingsController.test.ts`; #444 |

- [ ] **Step 2: Update the documents that describe the removed endpoints**

`docs/olx-import-foundation.md` opens with a line saying the import routes are unmounted under the stage-focus deviation and the service remains in use by sync. `ARCHITECTURE.md` and `docs/TESTING_GUIDE.md` no longer list the removed endpoints as available.

- [ ] **Step 3: Run the wave gate, `npm run test:visual`, and the manual journey**

Expected: every command exits 0; steps 1 to 4 of the tester guide pass on a Compose stand built from the branch.

- [ ] **Step 4: Commit**

```bash
git add docs ARCHITECTURE.md
git commit -m "docs: restate the product contract after the API cut"
```
