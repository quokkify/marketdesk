# Cut to the core: stage focus on autopilot selling

**Status:** approved by the owner on 2026-11-13 · **Baseline:** `main` at `7bd0e442f3`

MarketDesk drops every surface that does not serve one concept: AI sells a product on autopilot.
After four pull requests the navigation has 4 items instead of 6, the app has 6 routes instead
of 9, Settings has 4 sections instead of 9, the backend runs 2 job queues instead of 3, and the
database schema is unchanged. Nothing in this design builds the autopilot; it clears the ground
for it.

## 1. Intent

The owner's stage goal, in their words: get the single most important concept of the service
working, "selling fully on autopilot through AI". Everything else is secondary at this stage; the
owner named notifications, analytics, and the levels of AI involvement when analysing a product
and its position on the marketplace. Issue #290 holds the owner's longer description of the
target: a sales agent that accompanies a sale from preparing the listing to closing the
conversation with the buyer, while MarketDesk keeps ownership of business truth, domain rules,
marketplace operations, audit and safety.

Today the product is a seller back-office built to an 18-section PRD, with AI as a side panel.
The cut removes the back-office weight so that the next project, building the loop, starts from
a small surface.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Delete code that has no caller, no client or no producer.
2. Delete the secondary screens: Analytics, Dashboard, the Listings page, the roadmap grid on
   Marketplaces, the notification matrix, and the Security, API Keys and Telegram placeholders.
3. Hide what the core loop still touches but the owner does not need at this stage: the autonomy
   settings, the catalogue-wide Hermes run, and the import of existing OLX adverts.
4. Keep the core loop working and provable in the sandbox after every pull request.
5. Record the stage focus in the product contract, so that later pull requests and agents that
   read `docs/spec/` do not restore what was cut.

**Non-goals**

- Building any part of the autopilot loop. Appendix A lists what blocks it today.
- Release process, CI, test infrastructure and documentation weight. That is a separate decision.
- Schema changes. No table or column is dropped (see Constraints).
- Redesigning the screens that stay.
- Validating real-mode OLX behaviour.

**Anti-goals** (the cut has failed if any of these happens, even with green checks)

- The sandbox journey breaks: register, connect sandbox OLX, create a product, publish, receive
  a suggestion, approve it.
- The path from an approved AI proposal to a live advert is lost.
- Sale records stop being written during sync.
- A visible control remains that does nothing, or a link points at a removed route.
- Real-mode synchronisation changes behaviour as a side effect of a UI cut.

## 3. Constraints

Each constraint was checked against the code at the baseline commit.

| Constraint | Evidence | Consequence |
| --- | --- | --- |
| The migration runner has no ledger and executes every SQL file on every start. | `src/backend/persistence/migrate.ts:118-151` | Tables and columns stay; code stops reading them. Drops need a separate project that first gives the runner a ledger. |
| Approving a Hermes event is the only producer of jobs that update a live advert. | `mode: 'update'` occurs only at `src/backend/application/usecases/ApproveHermesEventUseCase.ts:718` | The Hermes feed, approve and dismiss stay. |
| The product contract is machine-checked: exactly 18 PRD rows with a fixed status vocabulary. | `scripts/verify-spec-traceability.mjs:44`; conflict rule in `docs/spec/README.md` | Rows are re-statused, never deleted. Every pull request that changes behaviour updates `TRACEABILITY.md`. |
| `tsc` skips tests and Jest collects everything under `src`. | `tsconfig.json` excludes `*.test.*`; `jest.config.js:6` | Each wave type-checks tests with a temporary tsconfig. Hidden backend code keeps its tests green. |
| Sign-in loads the workspace through `GET /api/workspaces/:id`. | `src/frontend/components/AuthBootstrap.tsx:46` | That endpoint stays. |
| `GET /api/analytics/overview` feeds kept screens. | `src/frontend/pages/HermesActivityPage.tsx:313`, `src/frontend/pages/MarketplacesPage.tsx:92-93` | It stays mounted while a kept screen reads it. |
| The Marketplaces card links to the Listings page. | `src/frontend/components/marketplaces/MarketplaceCard.tsx:20` | The link is repointed or removed together with the page. |
| The repository is public. | organisation rule | No secrets, internal URLs or machine paths in code, docs or pull requests. |

## 4. Approaches

Three independent proposals were produced from the same brief and compared criterion by criterion.

| Approach | What it does | Trade-off |
| --- | --- | --- |
| **Clear-out** (chosen) | Deletes dead code and secondary screens; hides what is entangled with the OLX spine; keeps the Hermes feed with approve. | Four small pull requests, no schema change, each reverted with `git revert`. Some hidden backend code keeps running in tests. |
| Deep cut | Also deletes the Hermes recommendation machinery: feed, approve and dismiss, the SEO agent, the periodic run. The live-update code is extracted from the approve use case first. | Removes 9,000 to 11,000 lines, but needs a refactor of a 775-line use case with 1,500 lines of tests, and until the agent exists there is no working path from an AI proposal to a live advert and no screen for synchronisation problems. |
| Hide only | Deletes only dead code; unmounts every secondary screen and keeps its code. | Fastest and most reversible, but about 9,000 hidden lines keep compiling and running tests and must be repaired whenever the spine changes. |

The owner chose **Clear-out** on 2026-11-13. The reasons: the shortest route to autopilot is to
automate the existing approve step rather than delete and rebuild it, and hidden code is a cost
that is deferred, not removed.

## 5. The design

**Terms.** *Delete* removes code, tests, dependencies and documentation of a surface; git history
is the archive. *Hide* removes entry points (navigation item, route, page section, router line)
and leaves backend code, domain logic and stored data in place. Inside a page file, hiding a
section means deleting its markup.

### 5.1 Delete: no caller, no client or no producer

| Surface | Evidence |
| --- | --- |
| Email and Telegram notifiers | Constructed and discarded at `src/backend/config/di/container.ts:300-303` |
| WebSocket live updates, the in-process subscriber port that only it uses, and the `ws` dependency | Attached at `src/backend/main.ts:182`; no client in `src/frontend`; the only `subscribe` call outside tests is `src/backend/presentation/websocket/HermesLiveUpdates.ts:85` |
| `hermes-run` queue and its handler | Created at `container.ts:387`; no `enqueue` call outside tests |
| Redis cache | Built at `container.ts:256`; never read |
| Allegro, Vinted, Facebook and eBay adapters | Registered at `src/backend/infrastructure/adapters/MarketplaceAdapterFactory.ts:41-44`; only `olx` rows are created (`src/backend/presentation/http/controllers/AuthController.ts:109-116`) |
| Unused dependencies: `axios`, `passport`, `passport-jwt`, `redis`, `uuid`, `date-fns`, `joi`, `@tanstack/react-query`, dev `docker-compose` | No import in tracked sources; `@tanstack/react-query` appears only as a chunk name in `vite.config.ts:34` |
| Security, API Keys and Telegram panels in Settings; the disabled notifications bell | Placeholders labelled "Not available in this release" |
| Three permanently disabled bulk buttons in Products | `src/frontend/pages/ProductsPage.tsx:740-796`; Export CSV stays |
| Frontend hook for `PATCH /api/workspaces/:id` | No call site |

Publishing domain events stays. Every use case publishes through `eventPublisher`, which appends
to a Redis stream (`src/backend/infrastructure/eventBroker/RedisEventBroker.ts:44-62`); that
stream is the seam a future agent trigger can read. Nothing reads or trims it today.

A stored marketplace row with a key other than `olx` must fail closed with a clear error and must
never reach a stub adapter. Today `PATCH /api/marketplaces/:id` with `connected: true` connects
such a row without OAuth (`src/backend/presentation/http/controllers/MarketplaceController.ts:234-241`);
the wave that deletes the adapters closes that path.

### 5.2 Delete: secondary at this stage

| Surface | Scope |
| --- | --- |
| Notifications | The matrix in Settings, `GET` and `PATCH /api/settings/notifications`, and the code that reads `notification_preferences`. The table stays. |
| Analytics | The page, its charts and table, `GET /api/analytics/revenue`, `GET /api/analytics/listings`, and `recharts` once no chart remains. |
| Dashboard | The page and its presentation module. `/` redirects to `/products`. |
| Listings page | The route and page. The listings table on the product page stays. |
| Roadmap channels on kept screens | The roadmap grid and summary bar on Marketplaces, the six disabled channels in the wizard's Marketplaces step (`src/frontend/components/forms/ProductWizardForm.tsx:98-106`), which then lists OLX only, and the roadmap channels listed in the Marketplace Accounts panel of Settings. The OLX card, configure drawer, connect, check and sync stay. |

The `MarketplaceKey` union and its name map stay. They are the vocabulary of stored rows, and
narrowing them could break the mapping of a stored row with another key.

The write side of analytics stays: sync keeps appending rows to `analytics_events`
(`container.ts:663-688`), the only durable record that an item sold.

### 5.3 Hide: entry points removed, code and data stay

| Surface | What is removed | What stays |
| --- | --- | --- |
| Settings, Hermes AI section | The whole section: autonomy tiers, guardrail switches, creativity preset, agent switch | `GET` and `PATCH /api/settings/hermes`, the workspace columns, the engine's tier and guardrail logic |
| Catalogue-wide Hermes run | Legacy `POST /api/hermes/run`, its use case and wiring | `HermesDecisionEngine.run()` and its tests |
| Import of existing OLX adverts | The panel on Marketplaces and the two import routes | `MarketplaceImportService`, which sync still calls |

The autonomy tiers already have no effect that the interface can reach: the Settings page says
scheduled catalogue runs are disabled (`src/frontend/pages/SettingsPage.tsx:166-167`). Stored
values keep applying, and the settings API stays for changing them.

### 5.4 Keep

Sign-in and workspace tenancy; Products, the six-step wizard and the product page with
publication review, readiness check, improvements and price history; the Hermes AI page with
approve and dismiss; the Marketplaces page for OLX; Settings sections General, Marketplace
Accounts, Appearance and About; the command palette, without entries for removed pages.

On the backend: the publication pipeline, the OLX adapter with OAuth, taxonomy, credential vault
and quota guard; sync and its scheduler; the AI provider stack with the offline heuristics; the
assistance graph, the agent catalogue and the experiment harness; price history, the activity
log and uploads; the sandbox.

Category reconciliation stays untouched: mismatch detection during sync, the audited delist and
recreate operations with their controls on Hermes event cards
(`src/frontend/components/hermes/HermesEventCard.tsx:396`), and product-category sync. Hiding
them would change real-mode sync behaviour, and the sandbox never produces a category mismatch,
so the change could not be proven and would simplify nothing in the stage's proof bed. The chosen
approach first listed category repair as hidden; the owner reversed that on 2026-11-13.

## 6. Delivery

Four pull requests, in order. Each is one squashed commit on `main`.

| Wave | Scope | Why at this position |
| --- | --- | --- |
| **W0** Stage-focus record | This document, the implementation plan, and one approved deviation, "Stage focus: autopilot selling", in `docs/spec/PRODUCT.md` that names the surfaces to be deleted and hidden and cites the new tracking issue (section 7). The same change amends item 4 of the source-of-truth hierarchy in `PRODUCT.md`, which today says maturity limits "do not remove the PRD capability or roadmap surface", so that this deviation may remove one. | The conflict rule in `docs/spec/README.md` makes every later pull request non-compliant without a recorded decision. |
| **W1** Dead wiring | Section 5.1, backend and dependencies. No visible change. | No runtime reach, so the lowest risk; it shrinks the dependency-injection file before larger diffs. |
| **W2** Shell cut | The frontend halves of sections 5.1 to 5.3. | Backend contracts stay fixed, so the API test suites are an unchanged reference. |
| **W3** API follows UI | The backend halves of sections 5.2 and 5.3. | "No caller" becomes true only after W2. |

**Gate for every wave**

1. `npm run type-check` and `npm run lint`.
2. Type-check of test files with a temporary tsconfig.
3. `npm test`.
4. `npm run verify:spec`.
5. `npm run experiment:assistance`.
6. `npm run build`, and for W2 the Playwright publication-journey spec.
7. On a Compose stand: steps 1 to 4 of `docs/TESTING_GUIDE.md` by hand.

**Core-loop proof.** No wave may weaken these tests; a wave that has to is out of scope and stops:
`sandboxPublishJourney.e2e.test.ts`; the publish, relist, delete and approve cases of
`productFlow.e2e.test.ts`; `PublishListingUseCase.test.ts`; `ApproveHermesEventUseCase.test.ts`;
`OlxPublicationQuotaService.test.ts`; the sync cases of `jobHandlers.test.ts`;
`idor.integration.test.ts`.

**Documentation.** Each wave updates, in the same pull request, the `TRACEABILITY.md` rows and
the user-facing documents it makes untrue: `README.md`, `docs/TESTING_GUIDE.md`,
`docs/spec/PRODUCT.md` and the affected sections of `ARCHITECTURE.md`. Changelogs are generated
and are not edited by hand.

**Database.** No wave contains a migration.

**Rollback.** `git revert` of the wave's commit. Nothing stored is destroyed.

**Versioning.** Pull-request titles follow Conventional Commits; a wave that removes a visible
feature carries `!`.

## 7. Decisions

**Decided by the owner**

- The stage goal and the three named secondary areas (section 1).
- The Clear-out approach, including: delete Analytics, Dashboard, the Listings page and the
  roadmap grid; hide the autonomy settings, the catalogue run and import; keep the Hermes feed
  with approve.
- Category repair by recreation stays untouched (section 5.4).
- A new GitHub issue records this cut. Its text is shown to the owner and the issue is created
  only after the owner approves it; #290 stays the concept issue.

**Calls made in this design** (the owner may overrule any of them)

- The Hermes AI section of Settings is hidden entirely, including the two controls that still
  have an effect (agent switch, creativity preset). Stored values keep applying.
- Roadmap channels leave the product wizard as well as the Marketplaces page; the
  `MarketplaceKey` union stays.
- Domain-event publishing stays; only the WebSocket and its subscriber port are deleted.
- `GET /api/workspaces/:id` and `GET /api/analytics/overview` stay.
- The command palette stays.
- Spec updates travel with each wave; W0 records only the decision.
- No tag is created; git history is the archive.

## 8. Left to the builder

- The exact file list of each wave, found by search at the time of the change and confirmed by
  the gate.
- Where the "sync issues" link on the Marketplaces card points after the Listings page is gone.
- Whether `GET /api/analytics/overview` and the `/api/settings/integrations` items for Telegram
  and API keys still have a reader after W2, and their removal if not.
- Unused environment keys and `.env.example` entries: each confirmed by search before removal.
- The wording of the deviation row and of the re-statused traceability rows.

## 9. Follow-up projects

- **Build the loop.** Appendix A is its starting gap list.
- **Process weight.** Three independently versioned components for one deployed image, a Gradle
  project for two API test classes, eight `verify:*` scripts.
- **Product contract.** Whether the 18-section PRD stays canonical or #290 plus a stage-scope
  page replaces it.
- **Schema cleanup.** A migration ledger, then drops of unread tables and columns.

## Appendix A. What blocks autopilot today

Checked against the code; none of it is fixed by this cut.

1. The model never sees photos. The completion boundary is text only
   (`src/backend/infrastructure/external/HermesAI.ts:47-55`); the photo draft asks for a title
   and an analysis of text fields, drafts no description or price, and defaults the price to 0
   (`src/backend/application/services/ProductAIDraftService.ts:232,252-255`), which blocks
   publication.
2. A human chooses and confirms the OLX category.
3. Nothing triggers agent work. Sync defaults to manual (`AuthController.ts:115`), and the hourly
   job is scheduled only when marketplace settings are patched (`MarketplaceController.ts:258`).
4. A proposal reaches a live advert only after a human approves it.
5. Buyer conversations exist only as counters, and `docs/olx-engagement-metrics.md` forbids
   requesting or storing message content.
6. A detected sale does not close the product: `Product.markSold`
   (`src/backend/domain/entities/Product.ts:235`) has no production caller.
7. The sandbox cannot simulate a buyer or a sale, so the whole loop has no offline proof bed.
