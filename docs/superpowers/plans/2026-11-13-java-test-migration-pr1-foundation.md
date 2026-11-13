# Java Test Migration, Pull Request 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Java project `test-automation/` what every later stage needs: an authenticated API session, a `uiTest` Gradle task, and a browser that runs in a Selenium Grid container next to the application.

**Architecture:** Each Java test class registers its own account through the public API and works inside that workspace. API tests call the application on `127.0.0.1:3000` from the host. UI tests drive a browser inside a `selenium/standalone-chromium` container that sits on the application's Compose network, so the browser opens the application as `http://app:3000`. The existing CI script starts the application and the Grid, runs `test apiTest uiTest`, and removes both.

**Tech Stack:** Java 21, Gradle, TestNG, q4j 0.12.2 (`rest-assured`, `selenide`, `config`, `testng`), Allure, Docker Compose, Selenium Grid.

**Spec:** `docs/superpowers/specs/2026-11-13-java-test-migration-design.md`

**Scope of this plan:** pull request 1 of the four in the spec. It deletes no Jest or Playwright test. Pull requests 2, 3 and 4 each get their own plan after this one is merged, because they depend on what this one measures on the live stack (see "Later pull requests" at the end).

**Amendment made during execution (Task 2):** the browser cannot open `http://app:3000`, because the application sends `upgrade-insecure-requests` and HSTS and a browser applies them to every host except localhost. Wherever this plan says the Grid joins `marketdesk-network` and the browser opens `http://app:3000`, read instead: the `selenium` service uses `network_mode: "service:app"`, port 4444 is published through the `app` service in the Grid Compose file, and `MARKETDESK_UI_BASE_URI` is `http://localhost:3000`. The project also declares `com.codeborne:selenide` directly, because q4j `selenide` 0.12.2 publishes it at runtime scope only.

**Branch:** `test/java-test-foundation`, created from `docs/java-test-migration-design` so the spec and this plan travel with the code.

## Global Constraints

- Do not change `ci-kit`, `java-test-automation-template` or q4j. If a gap in one of them blocks a step, stop and report it.
- No test-only endpoints, switches or hooks in the application (`src/backend`, `src/frontend`). This pull request does not edit those folders at all.
- Do not weaken the application's CORS or security headers to make a test pass.
- Follow `test-automation/AGENTS.md` and `test-automation/AGENTS.project.md`: framework code in `src/main`, only tests and base test classes in `src/test`; no `RestAssured`, `System.getenv` or `System.getProperty` in Java code under `src/test`; settings come from Owner configs through `ConfigRegistry`.
- HTTP statuses are `org.apache.http.HttpStatus` constants, never number literals.
- No TestNG groups, no `testng.xml`. Test sets are split by package in Gradle.
- Steps, services and verifications hold no per-test state. Tests run in parallel.
- Before using a q4j class, read that module's README at the tag `v0.12.2` (`https://github.com/quokkify/q4j/blob/v0.12.2/<module path>/README.md`). The local q4j checkout on a developer machine may be older; do not rely on it.
- The repository is public: no secrets, internal URLs or machine paths in code, scripts or docs.
- Never run a migration or a destructive command against a developer's own Compose Postgres. The script's stack has its own `COMPOSE_PROJECT_NAME`.
- The Docker image for the Grid is pinned by tag and digest. Never `:latest`.
- One git command per shell call in a worktree session; do not use `git stash`.

## Review Focus

1. **`uiTest` is run with no Grid address.** Someone runs `./gradlew uiTest` on their machine without `BROWSER_REMOTE_URL`. Expected: the test uses a local browser against `MARKETDESK_UI_BASE_URI` (default `http://127.0.0.1:3000`), and `AGENTS.project.md` says so. Pinned by Task 2, step 11.
2. **The Grid address is set but the UI address is not.** The browser in the container would open `127.0.0.1:3000`, which is the container itself, and fail with a connection error that points nowhere. Expected: the script always sets both, and the docs name the pair. Pinned by Task 2, steps 8 and 11.
3. **The stack fails to start.** If the Grid or the application never becomes ready, the script must print the container logs, exit non-zero and still remove the containers and volumes. Pinned by Task 2, step 9.
4. **`./gradlew test` must stay offline.** It must not pick up `test.ui` or `test.api` classes and must pass with no stack running. Pinned by Task 2, step 4.
5. **Two test classes register at the same moment.** Emails must not collide under parallel runs or retries. Pinned by Task 1, step 1 (`registersTwoAccountsWithDifferentEmails`).

---

## File Structure

All Java paths are under `test-automation/src/main/java/dev/quokkify/marketdesk/` (framework) or `test-automation/src/test/java/dev/quokkify/marketdesk/test/` (tests).

| File | Responsibility |
|---|---|
| `model/RegistrationPojo.java` | request body of `POST /api/auth/register` |
| `model/CredentialsPojo.java` | request body of `POST /api/auth/login` |
| `model/AccountPojo.java` | a registered account as tests carry it: email, password, token, user id, workspace id |
| `service/AuthService.java` | the three auth endpoints |
| `service/ProductService.java` (modify) | adds the authorised product listing |
| `helper/AccountHelper.java` | registers a fresh account and returns an `AccountPojo` |
| `verification/AuthVerification.java` | assertions on auth responses |
| `verification/ProductVerification.java` (modify) | adds success and empty-list assertions |
| `step/AuthSteps.java` | auth actions |
| `step/ProductSteps.java` (modify) | adds the authorised listing |
| `step/BaseSteps.java` (modify) | adds `authSteps` and `loginPageSteps` |
| `config/MarketDeskUiConfiguration.java`, `config/MarketDeskUiConfig.java` | the UI base address |
| `src/main/resources/marketdesk-ui.properties` | its default |
| `helper/BrowserSession.java` | configures and closes the browser for a UI test |
| `page/LoginPage.java`, `page/package-info.java` | the login screen |
| `verification/LoginVerification.java` | assertions after sign-in |
| `step/LoginPageSteps.java` | open the login page, sign in |
| `test/api/AuthTest.java` | proving API tests |
| `test/api/ProductAuthorizationTest.java` (modify) | one authorised test |
| `test/ui/BaseUiTest.java`, `test/ui/package-info.java` | browser lifecycle for UI tests |
| `test/ui/LoginUiTest.java` | proving UI test |
| `test-automation/gradle/tests.gradle` (modify) | `uiTest`, exclusions, forwarded keys |
| `docker/selenium-grid/docker-compose.yml` | the Grid container |
| `scripts/ci-java-api-tests.sh` (modify) | starts the Grid, exports the two addresses, runs three tasks |
| `test-automation/AGENTS.project.md`, `docs/development.md` (modify) | how to run it |

The script keeps its name: `.ci/modules/java.yml` and `.copier-answers.java.yml` refer to it.

---

### Task 1: Authenticated API session

**Files:**
- Create: `model/RegistrationPojo.java`, `model/CredentialsPojo.java`, `model/AccountPojo.java`, `service/AuthService.java`, `helper/AccountHelper.java`, `verification/AuthVerification.java`, `step/AuthSteps.java`
- Modify: `service/ProductService.java`, `step/ProductSteps.java`, `verification/ProductVerification.java`, `step/BaseSteps.java`
- Test: `test/api/AuthTest.java` (create), `test/api/ProductAuthorizationTest.java` (modify)

**Facts about the application (read-only, from `src/backend/presentation/http`):**
- `POST /api/auth/register` takes `{email, password, workspaceName?}`; `password` has at least 8 characters. It answers `201` with `{"success": true, "data": {"token": "...", "user": {"id", "email", "workspaceId"}}}`.
- `POST /api/auth/login` takes `{email, password}` and answers `200` with the same `data` shape.
- `GET /api/auth/me` needs `Authorization: Bearer <token>`. Confirm the body shape of `/me` in `controllers/AuthController.ts` before writing its assertion; the email is expected under `data`.
- `GET /api/products` with a token answers `200` with `{"success": true, "data": [...], "pagination": {...}}`.
- Errors answer `{"success": false, "error": {"code": "..."}}`.

**Interfaces:**
- Consumes: `MarketDeskApiConfig.BASE_URI`; q4j `ApiService`, `ApiSteps<V>`, `BaseApiVerification<V>`.
- Produces:
  - `record AccountPojo(String email, String password, String token, String userId, String workspaceId)`
  - `AuthService`: `ValidatableResponse register(RegistrationPojo body)`, `ValidatableResponse login(CredentialsPojo body)`, `ValidatableResponse getCurrentUser(String token)`
  - `AccountHelper`: `AccountPojo registerNewAccount()`
  - `AuthSteps extends ApiSteps<AuthVerification>`: `AccountPojo registerNewAccount()`, `ValidatableResponse login(String email, String password)`, `ValidatableResponse getCurrentUser(String token)`
  - `AuthVerification`: `hasSucceeded(ValidatableResponse)`, `hasToken(ValidatableResponse)`, `hasUserEmail(ValidatableResponse, String expected)`
  - `ProductSteps`: `ValidatableResponse getProducts(String token)`
  - `ProductVerification`: `hasSucceeded(ValidatableResponse)`, `hasNoProducts(ValidatableResponse)`
  - `BaseSteps`: `protected final AuthSteps authSteps`

- [ ] **Step 1: Write the failing tests**

`test/api/AuthTest.java`:

```java
public class AuthTest extends BaseTest {

  @Test
  public void registersAccountAndReadsCurrentUser() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = authSteps.getCurrentUser(account.token());
    authSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasUserEmail(response, account.email());
  }

  @Test
  public void logsInWithRegisteredCredentials() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = authSteps.login(account.email(), account.password());
    authSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasToken(response);
  }

  @Test
  public void registersTwoAccountsWithDifferentEmails() {
    AccountPojo first = authSteps.registerNewAccount();
    AccountPojo second = authSteps.registerNewAccount();
    authSteps.verify().hasDifferentEmails(first, second);
  }
}
```

Add to `ProductAuthorizationTest`:

```java
  @Test
  public void listsNoProductsForNewWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = productSteps.getProducts(account.token());
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasNoProducts(response);
  }
```

`AuthVerification` also gets `hasDifferentEmails(AccountPojo first, AccountPojo second)`.

- [ ] **Step 2: Run the compile to verify it fails**

Run from `test-automation/`: `./gradlew testClasses --console=plain`
Expected: FAIL, `cannot find symbol` for `authSteps` and `AccountPojo`.

- [ ] **Step 3: Implement the models, `AuthService` and the `ProductService` addition**

`AuthService` keeps the paths `/api/auth/register`, `/api/auth/login`, `/api/auth/me` as constants and follows `HealthService`. `ProductService.getProducts(String token)` is an overload that adds the header `Authorization: Bearer <token>`; the existing no-argument method stays and keeps serving `getProductsUnauthenticated()`. Records in `model` are named `*Pojo`, as `AGENTS.md` requires.

- [ ] **Step 4: Implement `AccountHelper.registerNewAccount()`**

The email is `"qa-" + UUID.randomUUID() + "@example.test"`, the password a fixed 12-character constant in the helper, and `workspaceName` is left out. The helper calls `AuthService.register`, requires `HttpStatus.SC_CREATED`, and builds the `AccountPojo` from `data.token`, `data.user.id` and `data.user.workspaceId`. If q4j's `ResponseHelper` covers "check status, then extract" at `v0.12.2`, use it.

- [ ] **Step 5: Implement `AuthVerification`, `AuthSteps`, the `ProductSteps` and `ProductVerification` additions, and the `BaseSteps` field**

Every public step and verification method carries `@Step`. `hasNoProducts` asserts `data` is an empty array. `AuthSteps.registerNewAccount()` delegates to `AccountHelper`.

- [ ] **Step 6: Run the static gates**

Run from `test-automation/`: `./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest verifyArchitecture --console=plain`
Expected: `BUILD SUCCESSFUL`, and `Gate: fail on ERROR -> passed`.

- [ ] **Step 7: Run the tests against the stack**

Run from the repository root: `bash scripts/ci-java-api-tests.sh`
Expected: `BUILD SUCCESSFUL`; the output lists `AuthTest > registersAccountAndReadsCurrentUser PASSED`, the two other `AuthTest` methods and `listsNoProductsForNewWorkspace` as `PASSED`. The script needs Docker and the host ports 3000, 5432 and 6379 free; if a developer's own stack holds 5432 or 6379, pass `DB_PORT` and `REDIS_PORT` with free values in the environment.

- [ ] **Step 8: Commit**

```bash
git add test-automation/src
git commit -m "test: add an authenticated API session to the Java tests"
```

---

### Task 2: `uiTest` through a Selenium Grid

**Files:**
- Create: `docker/selenium-grid/docker-compose.yml`, `config/MarketDeskUiConfiguration.java`, `config/MarketDeskUiConfig.java`, `src/main/resources/marketdesk-ui.properties`, `helper/BrowserSession.java`, `page/package-info.java`, `page/LoginPage.java`, `verification/LoginVerification.java`, `step/LoginPageSteps.java`, `test/ui/package-info.java`, `test/ui/BaseUiTest.java`, `test/ui/LoginUiTest.java`
- Modify: `test-automation/gradle/tests.gradle`, `step/BaseSteps.java`, `scripts/ci-java-api-tests.sh`, `test-automation/AGENTS.project.md`, `docs/development.md`

**Facts about the application (read-only):**
- The login screen is at `/login` (`src/frontend/pages/LoginPage.tsx`): one `input[type=email]`, one `input[type=password]`, a `button[type=submit]` labelled "Sign in".
- After sign-in the application navigates to `/products`, whose search field has `aria-label="Search products"`.
- In Compose the application's service is `app`, on the network `marketdesk-network`, listening on port 3000.

**Interfaces:**
- Consumes: `AuthSteps.registerNewAccount()` and `AccountPojo` from Task 1; q4j `selenide` module: `Page`, `PageSteps<S, V, P>`, `Verification<S, V, P>`, `Browser`, `BrowserConfiguration` (key `BROWSER_REMOTE_URL`). Confirm these names in the module README at `v0.12.2`.
- Produces:
  - `MarketDeskUiConfig.BASE_URI` (Owner key `MARKETDESK_UI_BASE_URI`, default `http://127.0.0.1:3000`)
  - `BrowserSession`: `static void open()`, `static void close()`
  - `LoginPageSteps extends PageSteps<LoginPageSteps, LoginVerification, LoginPage>`: `LoginPageSteps openLoginPage()`, `LoginPageSteps signIn(String email, String password)`
  - `LoginVerification`: `LoginVerification productsCatalogueIsShown()`
  - `BaseSteps`: `protected final LoginPageSteps loginPageSteps`
  - `BaseUiTest extends BaseTest` (abstract, in `test.ui`)
  - Gradle task `uiTest`

- [ ] **Step 1: Write the failing test**

`test/ui/LoginUiTest.java`:

```java
public class LoginUiTest extends BaseUiTest {

  @Test
  public void signsInAndLandsOnProducts() {
    AccountPojo account = authSteps.registerNewAccount();
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }
}
```

`test/ui/BaseUiTest.java`:

```java
public abstract class BaseUiTest extends BaseTest {

  @BeforeClass(alwaysRun = true)
  public void openBrowserSession() {
    BrowserSession.open();
  }

  @AfterMethod(alwaysRun = true)
  public void closeBrowserSession() {
    BrowserSession.close();
  }
}
```

- [ ] **Step 2: Run the compile to verify it fails**

Run from `test-automation/`: `./gradlew testClasses --console=plain`
Expected: FAIL, `cannot find symbol` for `BrowserSession` and `loginPageSteps`.

- [ ] **Step 3: Add the Gradle task and the exclusions in `gradle/tests.gradle`**

- Forward both `MARKETDESK_API_BASE_URI` and `MARKETDESK_UI_BASE_URI` system properties to the test JVM (one loop over the two keys replaces the single `if`).
- `test` excludes `**/test/api/**` and `**/test/ui/**`.
- Register `uiTest` exactly like `apiTest`, with `include '**/test/ui/**'`, the description `Runs UI tests against a running MarketDesk application.`, and `shouldRunAfter tasks.named('apiTest')`.

- [ ] **Step 4: Verify `test` stays offline**

Run from `test-automation/` with no stack running: `./gradlew test --console=plain`
Expected: `BUILD SUCCESSFUL`, and no test from `test.api` or `test.ui` in the output.

- [ ] **Step 5: Implement the UI configuration and `BrowserSession`**

`MarketDeskUiConfiguration` and `MarketDeskUiConfig` mirror the API pair. `BrowserSession.open()` applies q4j's default browser configuration, switches to q4j's remote configuration when `BrowserConfiguration.remoteUrl()` is set (read through `ConfigRegistry`, not `System.getenv`), runs headless, and sets Selenide's base URL to `MarketDeskUiConfig.BASE_URI`. `BrowserSession.close()` closes the WebDriver. If the `selenide` README at `v0.12.2` says a plain remote session also needs the `dev.quokkify:selenide-grid` module, add it to `gradle/libs.versions.toml` with `version.ref = "q4j"` and to `gradle/dependencies.gradle` as `implementation`; otherwise do not add it.

- [ ] **Step 6: Implement `LoginPage`, `LoginVerification`, `LoginPageSteps` and the `BaseSteps` field**

Locators: `input[type=email]`, `input[type=password]`, `button[type=submit]`. `openLoginPage()` opens the relative path `/login`. `productsCatalogueIsShown()` waits, with the verification's own timeout, for `[aria-label="Search products"]` to be visible. The new package `page` gets a `package-info.java` stating its purpose, like the generated packages.

- [ ] **Step 7: Run the static gates**

Run from `test-automation/`: `./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest verifyArchitecture --console=plain`
Expected: `BUILD SUCCESSFUL`, and `Gate: fail on ERROR -> passed`.
If `verifyArchitecture` rejects the package `page`, stop and report: `AGENTS.md` names no package for page objects, and that is a gap in the template, which this work must not patch.

- [ ] **Step 8: Add the Grid and wire the script**

`docker/selenium-grid/docker-compose.yml` declares one service:

```yaml
services:
  selenium:
    image: selenium/standalone-chromium:<tag>@sha256:<digest>
    shm_size: 2g
    ports:
      - "127.0.0.1:${SELENIUM_PORT:-4444}:4444"
    networks:
      - marketdesk-network
```

Take the newest stable `selenium/standalone-chromium` tag and its multi-arch digest with `docker buildx imagetools inspect selenium/standalone-chromium:<tag>` and write both in.

In `scripts/ci-java-api-tests.sh`:
- export `COMPOSE_FILE="docker-compose.yml:docker/selenium-grid/docker-compose.yml"` before the first `docker compose` call, so that `up`, `logs` and `down` all see both files;
- after the application is ready, wait the same way (bounded loop) for `http://127.0.0.1:4444/status` to report `"ready": true`;
- export `BROWSER_REMOTE_URL=http://127.0.0.1:4444/wd/hub` and `MARKETDESK_UI_BASE_URI=http://app:3000`;
- run `./gradlew test apiTest uiTest --console=plain`.

- [ ] **Step 9: Verify the failure path of the script**

Add `selenium` to the services whose logs are printed when readiness fails. Then run once with a wrong Grid port: `SELENIUM_PORT=4455 bash scripts/ci-java-api-tests.sh`
Expected: the script prints `docker compose ps` and the logs, ends with a message that the Grid did not become ready, exits non-zero, and `docker compose ls` afterwards shows no project named `marketdesk-java-local-1`.

- [ ] **Step 10: Run everything against the stack**

Run from the repository root: `bash scripts/ci-java-api-tests.sh`
Expected: `BUILD SUCCESSFUL`; `LoginUiTest > signsInAndLandsOnProducts PASSED`; `test-automation/build/allure-results` holds a `*-result.json` for it that lists the steps.
If sign-in fails only because the page is opened as `http://app:3000` (CORS, a security header, a browser API that needs a secure context), stop and report what the browser console and the application log say. Do not change the application.

- [ ] **Step 11: Document how to run it**

In `test-automation/AGENTS.project.md` add: the `test.ui` package and the `uiTest` task; the key `MARKETDESK_UI_BASE_URI`; that with `BROWSER_REMOTE_URL` set the browser runs in the Grid and `MARKETDESK_UI_BASE_URI` must then be an address the Grid container can reach (`http://app:3000` in the script's stack); that with `BROWSER_REMOTE_URL` unset `uiTest` uses a local browser against the default address; that page objects live in the package `page`. In `docs/development.md` update the paragraph on Java tests to name the three tasks and the Grid. Then run from the repository root: `npm run verify:spec && npm run verify:compose-db && npm run verify:compose-uploads`
Expected: all three pass.

- [ ] **Step 12: Commit**

```bash
git add test-automation docker/selenium-grid scripts/ci-java-api-tests.sh docs/development.md
git commit -m "test: run Java UI tests through a Selenium Grid"
```

---

### Task 3: Measure the live stack and open the pull request

**Files:**
- Modify: `scripts/ci-java-api-tests.sh` (only if the measurement below requires it)

**Interfaces:**
- Consumes: the script and the account registration from Tasks 1 and 2.
- Produces: three recorded facts that the plans for pull requests 2 to 4 rely on.

- [ ] **Step 1: Measure the AI fallback**

Start the stack the way the script does, register an account with `curl`, and time one call that needs the AI provider: `POST /api/products/ai-draft` with a title, and `GET /api/hermes/status`, both with the token.
Expected: the status reports `"activeProvider": "offline"`, and the draft call returns in under 5 seconds.
If it waits for the 30-second Hermes timeout instead, export `HERMES_API_URL=http://127.0.0.1:9/v1` in the script (a closed port, so the connection is refused at once), run the measurement again, and commit that change as `test: point the test stack at a closed Hermes port`.

- [ ] **Step 2: Confirm there is no skipped or placeholder work**

Run from the repository root: `grep -rnE "TODO|FIXME|enabled *= *false|@Ignore" test-automation/src docker/selenium-grid scripts/ci-java-api-tests.sh`
Expected: no output.

- [ ] **Step 3: Push and open the pull request**

Push the branch and open a pull request titled `test: lay the Java foundation for API and UI tests`. The description states: what the pull request adds; that it deletes no test; the measured AI fallback time and what was done about it; that the frontend is served from the Docker image (proved by `LoginUiTest`); and a test plan listing the commands of Task 1 step 7 and Task 2 steps 4, 9 and 10.

- [ ] **Step 4: Record the CI job duration**

When CI finishes, read the duration of the job `java (Java test automation)` for this pull request and for the latest run on `main`, and add both numbers to the pull request description.
Expected: the Java job is green and an Allure result for `LoginUiTest` is in the artifact `allure-results-marketdesk-java`.

---

## Later pull requests

Each gets its own plan, written after this pull request is merged, from the same spec.

- **Pull request 2, API contracts.** Sort every test of `api.integration.test.ts` (72), `idor.integration.test.ts` (14) and `uploads.integration.test.ts` (6) into *moves*, *stays* or *dropped*; write the Java tests; delete or narrow the Jest files; keep coverage at 70% or above. Needs from this pull request: the account session and the AI fallback measurement.
- **Pull request 3, journeys.** Move `productFlow.e2e.test.ts` (11) and `sandboxPublishJourney.e2e.test.ts` (1). Adds product and listing creation steps, the OLX sandbox connection, and bounded polling for the asynchronous publish. Needs: whether a public route yields a pending Hermes event on the stub stack.
- **Pull request 4, UI and Playwright removal.** Rewrite `tests/visual/publication-journey.spec.ts` as a Selenide test through the Grid; remove Playwright, its config, script and dependency; update `docs/spec/TRACEABILITY.md`. Needs: `BaseUiTest`, `BrowserSession` and the Grid from this pull request.

**Deviation from the spec, for the owner to confirm:** the spec lists "product and listing creation steps" under the foundation. This plan moves them to pull requests 2 and 3, where the first tests that use them are written, so that the foundation adds no step that nothing calls.
