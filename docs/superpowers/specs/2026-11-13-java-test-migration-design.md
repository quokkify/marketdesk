# Move integration, API and UI tests to the Java project

Date: 2026-11-13. Status: awaiting owner approval.

## Intent

The owner wants one rule for where a test lives:

- A unit test stays next to the module it tests, in Jest.
- Every test that checks the system as a whole (integration, API, UI) runs from the Java project
  `test-automation/`, which was generated from the owner's `java-test-automation-template` and is built on q4j,
  TestNG and Allure.

The owner maintains that template and q4j, and wants MarketDesk's automated testing to go through that solution
instead of through Jest with supertest and through Playwright.

## Current state

- `test-automation/` exists (template v1.4.0, base package `dev.quokkify.marketdesk`). It has two API tests
  (`HealthTest`, `ProductAuthorizationTest`) and already depends on the q4j modules for REST Assured, SQL, Selenide,
  Tyrus and Jackson.
- CI already runs it. `.ci/modules/java.yml` sets the component's test command to
  `bash ../scripts/ci-java-api-tests.sh`. That script starts the Compose stack with a throwaway credentials key,
  waits for `/ready`, runs `./gradlew test apiTest`, and removes the stack. Allure results are uploaded as the
  artifact `allure-results-marketdesk-java`.
- `gradle/tests.gradle` splits tests by package: `apiTest` includes `**/test/api/**`, and `test` excludes it.
- Jest holds 150 test files. Five of them drive the whole HTTP application in-process with supertest over
  `buildApp(deps)`, on in-memory repositories, a fake marketplace adapter and a synchronous queue:

  | File | Tests |
  |---|---|
  | `src/backend/presentation/__tests__/api.integration.test.ts` | 72 |
  | `src/backend/presentation/__tests__/idor.integration.test.ts` | 14 |
  | `src/backend/presentation/__tests__/uploads.integration.test.ts` | 6 |
  | `src/backend/__tests__/e2e/productFlow.e2e.test.ts` | 11 |
  | `src/backend/__tests__/e2e/sandboxPublishJourney.e2e.test.ts` | 1 |

- Playwright has one file with one test, `tests/visual/publication-journey.spec.ts`. It mocks every `/api/` call and
  writes three screenshots into `docs/screenshots/issue-290`. CI does not run it.
- `docs/spec/TRACEABILITY.md` names some of these test files.

## Goals

1. The behaviour covered by the five in-process files is covered by Java tests that call the running Compose stack.
2. The Playwright scenario is covered by a Java UI test that drives a real browser against the running stack.
3. Playwright is removed from the repository: the test, `playwright.config.ts`, the `test:visual` script and the
   `@playwright/test` dependency.
4. After the last pull request, no Jest file drives the whole application over HTTP to check a behaviour that a Java
   test can check from outside.

## Non-goals

- Changing `ci-kit`, `java-test-automation-template` or q4j. If a gap in one of them blocks the work, report it to
  the owner instead of patching it from this repository.
- Moving tests that call TypeScript classes directly. These stay in Jest: the five Postgres tests for repositories
  and migrations, `BullJobQueue.test.ts` and `main.boot.test.ts`. Java cannot call those classes.
- Visual regression testing. The three screenshots in `docs/screenshots/issue-290` stay as static files and are no
  longer regenerated.
- Raising coverage beyond what the moved tests covered.

## Anti-goals

- No test-only endpoints, switches or hooks in the application to let Java inject a failure or a canned answer.
- No Jest test is deleted before its Java replacement has passed in CI in the same pull request.
- The Jest coverage threshold (70%) is not lowered to make a deletion pass.

## Constraints

- Java tests see the application only from outside: HTTP on `127.0.0.1:3000`, the browser on the same origin, and
  optionally the database through q4j SQL.
- The stack under test is the one `scripts/ci-java-api-tests.sh` starts: `NODE_ENV=test`, `OLX_ADAPTER_MODE=stub`,
  and no reachable Hermes server.
- Tests run in parallel through the q4j `SuiteListener`. Steps and services hold no per-test state; a test that needs
  the stack to itself is marked `@SingleThread`.
- `verifyArchitecture`, Checkstyle and SpotBugs must stay green. API tests pass statuses as `HttpStatus` constants.
- Layout rules of `test-automation/AGENTS.md` and `AGENTS.project.md` apply: framework code in `src/main`, only
  tests and `BaseTest` in `src/test`.
- The repository is public: no secrets, internal URLs or machine paths in tests, scripts or docs.
- The local Compose Postgres of a developer is never migrated or mutated by these tests; the stack runs under its
  own `COMPOSE_PROJECT_NAME`, as the script already does.

## Approaches

1. **Staged, four pull requests (chosen by the owner).** Foundation first, then the API contract tests, then the
   two journeys, then the UI test with the Playwright removal. Each Jest test is deleted in the pull request whose
   Java replacement is green in CI. Coverage never has a gap, and each pull request is small enough to review.
2. **One pull request.** Faster on the calendar. Rejected: the diff is large, and one scenario that behaves
   differently on the live stack than on the fakes would hold up the whole migration.
3. **Write all Java tests now, delete later.** The safest for coverage. Rejected: the same behaviour is checked
   twice for a while, and the cleanup is easy to postpone forever.

## Decided by the owner

- The five in-process files are rewritten in Java against the live stack, and their Jest versions are removed.
- A check that needs a dependency replaced from inside (an adapter failure, a canned AI answer, a database error
  code) stays in Jest as a unit test of the handler or controller it concerns.
- The Playwright test moves to Java as the UI end-to-end test.
- The work lands as the four staged pull requests above.
- UI tests run their browser in a Selenium Grid, connected the way q4j already supports. The browser installed on
  the CI runner is not used.

## Calls made in this design (not yet confirmed by the owner)

- **Sorting each test.** Every one of the 104 Jest tests and the one Playwright test gets exactly one verdict:
  - *moves*: a Java test asserts the same behaviour from outside;
  - *stays*: it needs an injected dependency, so it stays in Jest, narrowed to the handler, controller or
    middleware it concerns where that is practical;
  - *dropped*: another test already covers it, or the behaviour no longer exists. Each drop names the covering test
    or the reason.

  Each pull request description carries this table for the files it touches. Examples of *stays*: the duplicate
  email mapped from Postgres error 23505, "while Hermes is unreachable", the OLX adapter in `real` mode, and the
  product delete blocked by error 23503.
- **Every rate-limit check *stays*.** `main.ts` passes `enableRateLimit: !isTest` and its own limiters skip when
  `isTest`, and the stack under test runs with `NODE_ENV=test`. No limiter is mounted there, so Java cannot observe
  one. The rate-limit tests stay in Jest against the middleware. The stack keeps `NODE_ENV=test`; no second stack
  configuration is added for limiters.
- **Hermes events.** The Jest journey writes a pending event straight into the repository; Java cannot. The Java
  journey must produce the event through a public route, for example the product-scoped Hermes run, which on this
  stack goes through the offline provider. If no public route yields a pending event on the stub stack, the approve
  and dismiss checks get the verdict *stays*.
- **Counting.** A parameterised test (`it.each`) is one row in the sorting table.
- **Test data.** Each Java test class registers its own user and workspace through `POST /api/auth/register` with a
  unique email, and creates what it needs through the API. There is no shared seed and no cleanup; the stack is
  thrown away after the run. The cross-workspace (IDOR) tests register two workspaces.
- **Renaming what stays.** In-process Jest tests that remain are moved or renamed so that no file named
  `*.integration.test.ts` or `*.e2e.test.ts` drives `buildApp` any more. The Postgres tests keep their names.
- **Gradle tasks.** `apiTest` keeps the package `test.api` and gains the journeys. A new task `uiTest` runs the
  package `test.ui`, declared the same way as `apiTest`. `test` excludes both. The CI script runs
  `./gradlew test apiTest uiTest`.
- **UI test.** Selenide through q4j, with the browser in a Selenium Grid container (see "Decided by the owner").
  A new Owner key `MARKETDESK_UI_BASE_URI` holds the address the browser opens. The browser runs inside the Grid
  container, so in the test stack that address is the Compose service name, `http://app:3000`, while the API tests
  keep calling `http://127.0.0.1:3000` from the host. The test logs in through the login form and creates its product through the API. It
  asserts what a user sees: the product creation entry point, and that assistance suggestions are shown for review
  and are not applied on their own. It asserts structure, not the exact suggestion text.
- **CI.** No new workflow and no `ci-kit` change. The existing Java component keeps calling the script; the script
  gains `uiTest` and starts the Grid next to the application.
- **Grid shape.** One `selenium/standalone-chromium` container, pinned by tag and digest, declared in a separate
  Compose file that joins the application's network and is used only by the test script. It publishes port 4444 on
  `127.0.0.1`. A hub with dynamic nodes is not needed for one UI test. The q4j `selenide-grid` module is added only
  if its README at the project's q4j version says a plain remote session needs it; the remote URL itself is read by
  the q4j `selenide` module (`BROWSER_REMOTE_URL`).
- **Coverage.** After each deletion run `npm run test:coverage`. If it falls under 70%, add unit tests for the
  uncovered module in the same pull request.

## The four pull requests

1. **Foundation.** Registration and login steps, an authenticated request specification, product and listing
   creation steps, the `uiTest` task, the UI base URI configuration, the script change, and one proving test per
   task (an authenticated API call; a browser login). Updates `AGENTS.project.md` and `docs/development.md`.
   Deletes nothing.
2. **API contracts.** Sorts and moves `api.integration.test.ts`, `idor.integration.test.ts` and
   `uploads.integration.test.ts`. Deletes or narrows the Jest files.
3. **Journeys.** Sorts and moves `productFlow.e2e.test.ts` and `sandboxPublishJourney.e2e.test.ts`: register,
   connect the OLX sandbox, create a product, publish, relist, Hermes event approval. Deletes or narrows the Jest
   files.
4. **UI and Playwright removal.** Adds the Selenide test, removes Playwright and its dependency, and updates
   `docs/spec/TRACEABILITY.md` and any remaining references.

Each pull request also updates `docs/spec/TRACEABILITY.md` for the files it moves and keeps `npm run verify:spec`
green.

## Risks the builder must check before planning each stage

- **AI answers on the live stack.** With no Hermes server the application is expected to fall back to
  `OfflineHeuristicAIProvider` (`AIProviderSelector`). Compose points `HERMES_API_URL` at
  `host.docker.internal:8642` with a 30-second request timeout. In pull request 1, measure on the CI runner how long
  the fallback takes and whether the offline answers are stable enough for the planned assertions. If the fallback
  waits for the timeout, set `HERMES_API_URL` in the CI script to a closed local port so the connection is refused
  at once; that is stack configuration, not an application hook.
- **Publish finalisation is asynchronous on the live stack.** The Jest journeys use a synchronous queue. Java
  journeys must poll for the final listing state with a bounded wait.
- **Frontend origin.** `main.ts` serves `dist/frontend` with an SPA fallback when `index.html` exists, and Compose
  publishes the `app` service on port 3000. Confirm in pull request 1 that the image built by `Dockerfile` contains
  the frontend; the UI test depends on it.
- **The browser sees a different origin.** Through the Grid the page is opened as `http://app:3000`, which is not
  `localhost` and so is not a secure context. Confirm in pull request 1 that login works from that origin (CORS,
  security headers, any browser API that needs a secure context). If it does not, report it; do not weaken the
  application's headers for the test.
- **Forwarding the UI base URI.** `gradle/tests.gradle` forwards only `MARKETDESK_API_BASE_URI` to the test JVM;
  the new UI key needs the same forwarding.
- **Run time.** The CI job now builds the stack and runs three Gradle tasks. Record the job duration in pull
  request 1.

## Left to the builder

- Class and method names, and the split of services, steps and verifications inside the template's packages.
- Models for request and response bodies.
- How Selenide is configured (through the q4j Selenide module's own conventions).
- Whether a journey lives in `test.api` directly or in a subpackage of it.
- The exact wording of the sorting tables.

## Done when

- The four pull requests are merged, each with its Java tests green in CI.
- `grep` finds no `supertest` import in a file named `*.integration.test.ts` or `*.e2e.test.ts`.
- `@playwright/test` is absent from `package.json` and the lockfile.
- `npm run test:ci`, `npm run test:coverage` and `npm run verify:spec` pass.
- Every one of the 105 original tests has a verdict in a merged pull request description.
