# Publication Journey on Selenide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PR 500: every UI test chains through `backToSteps()`, the review findings are fixed, and the four Playwright scenarios with a *moves* verdict run as Selenide tests on the live stack.

**Architecture:** Page objects (`page/`) hold locators, `*PageSteps` act, `*PageVerification` assert and chain; API setup goes through existing `*Steps` + `*Service`. Tests in `src/test/java/.../test/ui/` only compose steps.

**Tech Stack:** Java 21, q4j 0.16.0 (Selenide, REST Assured, TestNG), Allure, Gradle; Compose stack with `OLX_ADAPTER_MODE=stub` and the Selenium Grid from `docker/selenium-grid/docker-compose.yml`.

**Spec:** `docs/superpowers/specs/2026-11-22-publication-journey-selenide-design.md`

## Global Constraints

- Branch `chore/remove-playwright` (PR 500). No changes to q4j, the template, ci-kit or application code.
- No test-only routes or switches in the application.
- Layout rules of `test-automation/AGENTS.md`: framework code in `src/main`, only tests and `BaseTest` in `src/test`; every public step has `@Step`; verifications return `this` and chain; no nested classes in `src/test`; no `RestAssured`/`System.getProperty` in `src/test`.
- One chain per page object: `steps.action().verify().check().backToSteps().nextAction()`; a new statement starts only when the page object changes.
- Tests run in parallel (q4j `SuiteListener`); every test registers its own account, so no shared state.
- `./gradlew check` must stay green (Checkstyle, SpotBugs, `verifyArchitecture`). `JAVA_HOME` = Homebrew `openjdk@21`.
- Public repository: no secrets, internal URLs or machine paths.

## Review Focus

- Parallel runs: the phone test resizes the window; the resize must not leak into another test (each test method closes its driver in `BaseUiTest.closeBrowserSession`, so resize inside the test only).
- Upload through the Grid: the photo is uploaded from the classpath (`uploadFromClasspath`), which Selenide sends through `LocalFileDetector`; a host file path would not exist in the Grid container.
- Category picker seeds its search with the product name; the test must type its own query and pick `Electronics > Cameras` (provider id `1001`) explicitly, not rely on the seed.
- Quota row: the quota is looked up by workspace, marketplace, connected account and subcategory `1001`, inside the cycle window; a window that does not contain "now" yields `outside_cycle` instead of `quota_exhausted` (both open the dialog, but the test asserts the listing stays unpublished either way).
- Double click: both clicks must happen in one JavaScript call, otherwise the first click re-renders the button as disabled and the test passes vacuously.

---

### Task 0: Live stand for verification

Not a commit. Start the stack the way `scripts/ci-java-api-tests.sh` does, but keep it running: own `COMPOSE_PROJECT_NAME=marketdesk-pr500`, env file outside the repo root, `COMPOSE_FILE=docker-compose.yml:docker/selenium-grid/docker-compose.yml`, wait for `/ready` and the Grid `/status`. If ports 3000/4444/5432/6379 are taken by another stack, use a port override file (see the isolated-stand notes). Export `BROWSER_REMOTE_URL` and `MARKETDESK_UI_BASE_URI` as the script does.

- [ ] Baseline: `./gradlew uiTest` in `test-automation` — record which tests pass before any edit (expected: all, including `PublicationJourneyUiTest`). A failing baseline test is reported, not fixed here.

### Task 1: Chain every UI test through `backToSteps()`

Pure refactor; behaviour and Allure step names unchanged.

**Files:**
- Modify: every class in `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/` that restarts a chain on the same `*PageSteps` field after `verify()` (`AiUsageUiTest`, `ConversationsUiTest`, `LoginUiTest`, `MarketplaceImportUiTest`, `PriceResearchUiTest`, `ProductsCatalogueUiTest`, `PublicationJourneyUiTest`, `RevivalUiTest`).

- [ ] **Step 1:** In each class, merge consecutive statements on the same steps field into one chain with `.backToSteps()`. Example for `PublicationJourneyUiTest`:

```java
productDetailPageSteps
    .openProductPage(productListing)
    .verify()
    .showsPublicationReadinessCheck()
    .backToSteps()
    .suggestImprovements()
    .verify()
    .showsSuggestionsForReviewOnly(PRODUCT_NAME)
    .backToSteps()
    .openPublicationDialog()
    .verify()
    .showsPublicationConfirmation();
```

- [ ] **Step 2:** `grep -n "Steps$" -A0 src/test/java/dev/quokkify/marketdesk/test/ui/*.java` and read each test: no two adjacent statements start with the same steps field.
- [ ] **Step 3:** `./gradlew check` — PASS; `./gradlew uiTest` — same result as the Task 0 baseline.
- [ ] **Step 4:** Commit `refactor(test): chain page steps through backToSteps`.

### Task 2: Review fixes in the existing publication test

**Files:**
- Modify: `test-automation/src/main/java/dev/quokkify/marketdesk/page/ProductDetailPage.java`
- Modify: `test-automation/src/main/java/dev/quokkify/marketdesk/verification/ProductsPageVerification.java`
- Modify: `test-automation/src/main/java/dev/quokkify/marketdesk/step/ListingSteps.java:104-130`
- Modify: `test-automation/src/test/java/dev/quokkify/marketdesk/test/ui/PublicationJourneyUiTest.java`

**Interfaces:**
- Produces: `ProductsPageVerification newProductDialogIsClosed()`.

- [ ] **Step 1:** In `PublicationJourneyUiTest`, extend the products chain: `.closeNewProductDialog().verify().newProductDialogIsClosed()`.
- [ ] **Step 2:** Implement `newProductDialogIsClosed()`: `page.newProductDialog().shouldNot(Condition.exist, getTimeout())` with `@Step("The New product dialog is closed")`.
- [ ] **Step 3:** `ProductDetailPage`: `suggestedImprovementsHeading`, `suggestedPriceHeading`, `reviewOnlyNote` locate by text inside the Hermes assistance card, without `h6`/`span`. Find the card's stable hook in `src/frontend` (a `data-testid`, `aria-labelledby` or its heading); if none exists, scope to `$$(".MuiCard-root").findBy(Condition.text(SUGGESTED_IMPROVEMENTS))` and match children with `Condition.text` via `$(byText(...))`/`$(withText(...))`.
- [ ] **Step 4:** `ListingSteps.publishSandboxOlxListing` calls `setSandboxOlxCategory(account, listingId)` instead of repeating the service call.
- [ ] **Step 5:** `[role="dialog"]`: check whether any page object already shares locators (a common constants class or a `Page` default method). If yes, move `DIALOG` there; if not, leave the per-page constants — the review nit is withdrawn (say so in the final report).
- [ ] **Step 6:** `./gradlew check` — PASS; `./gradlew uiTest --tests '*PublicationJourneyUiTest'` and `--tests '*MarketplaceImportUiTest'` (uses `publishSandboxOlxListing`; find the actual callers with grep and run their classes) — PASS.
- [ ] **Step 7:** Commit `test(ui): tighten the publication journey checks`.

### Task 3: Wizard happy path

**Files:**
- Create: `test-automation/src/main/resources/images/product-photo.png` (a small valid PNG, e.g. 64×64 solid colour; generate it, do not copy a screenshot)
- Modify: `page/ProductsPage.java`, `step/ProductsPageSteps.java`, `verification/ProductsPageVerification.java`
- Modify: `page/ProductDetailPage.java`, `verification/ProductDetailPageVerification.java`
- Modify: `step/ProductSteps.java` (API check), `verification/ProductVerification.java`
- Modify: `test/ui/PublicationJourneyUiTest.java`

**Interfaces:**
- Produces (`ProductsPageSteps`, all return `ProductsPageSteps`, all `@Step`):
  - `uploadProductPhoto()` — `page.photoInput().uploadFromClasspath("images/product-photo.png")`; the input is the hidden `input[type=file]` inside the dialog next to the `aria-label="Upload product photos"` control.
  - `continueToReview()` — button `Continue`.
  - `fillReview(String name, String description, String sellingPrice)` — fields by label `Name`, `Description`, `Selling price`.
  - `chooseOlxCategory(String query, String pathLabel)` — type into label `OLX category`, click button with text `pathLabel`.
  - `publishToOlx()` — button `Publish to OLX`, `shouldBe(enabled)` then click.
  - `createAndPublishFromWizard(String name)` — composes the five above with the constants below; used by Tasks 3–6.
- Produces (`ProductsPageVerification`): `reviewStepIsShown()` (heading `Review and publish`), `publishToOlxIsEnabled()`.
- Produces (`ProductDetailPageVerification`): `showsPublicationQueued()` — text `Publication was accepted and queued.` visible and no `[role="dialog"]`.
- Produces (`ProductSteps`): `List<String> findProductIdsByName(AccountPojo account, String name)` via `GET /api/products`.
- Test constants in `PublicationJourneyUiTest`: description `Mirrorless camera with lens, original battery and carrying bag. Fully working, with minor signs of use.`, price `1050`, category query `camera`, category label `Electronics > Cameras`.

- [ ] **Step 1: Write the test** `newProductIsQueuedFromTheWizard`:

```java
AccountPojo account = authSteps.registerNewAccount();
marketplaceSteps.connectSandboxOlx(account);
loginPageSteps.openLoginPage().signIn(account.email(), account.password())
    .verify().productsCatalogueIsShown();
productsPageSteps
    .openNewProductDialog()
    .uploadProductPhoto()
    .continueToReview()
    .verify()
    .reviewStepIsShown()
    .backToSteps()
    .fillReview(WIZARD_NAME, DESCRIPTION, PRICE)
    .chooseOlxCategory(CATEGORY_QUERY, CATEGORY_LABEL)
    .verify()
    .publishToOlxIsEnabled()
    .backToSteps()
    .publishToOlx();
productDetailPageSteps.verify().showsPublicationQueued();
productSteps.verify().hasExactlyOneProductNamed(account, WIZARD_NAME)
    .listingOfProductHasOlxCategory(account, WIZARD_NAME, "1001");
```

`WIZARD_NAME` is unique per run (e.g. `"Mirrorless camera kit " + UUID` prefix-shortened), so parallel tests never collide even if they share nothing.

- [ ] **Step 2:** Run `./gradlew uiTest --tests '*PublicationJourneyUiTest.newProductIsQueuedFromTheWizard'` — expected: compile FAIL (methods missing).
- [ ] **Step 3:** Implement the interfaces above. `hasExactlyOneProductNamed` and `listingOfProductHasOlxCategory` are `ProductVerification` API assertions (`GET /api/products`, then `GET /api/products/{id}/listings`, `marketplaceCategory.providerCategoryId`); add the listings call to `ProductService` only if it is not there yet.
- [ ] **Step 4:** Run the test — PASS. Then break it on purpose once (assert category `1002`), see it FAIL, restore.
- [ ] **Step 5:** `./gradlew check` — PASS. Commit `test(ui): create and queue a product from the wizard`.

### Task 4: Quota confirmation opens the publication review

**Files:**
- Create: `model/OlxQuotaRequestPojo.java` (record with the fields of `setOlxPublicationQuotaSchema`: `subcategoryId`, `cycleStartedAt`, `cycleEndsAt`, `publicationLimit`, `consumed`, `source`, `confidence`, `verifiedAt`, `staleAt`; factory `exhausted(String subcategoryId, Instant now)` → limit 1, consumed 1, source `operator`, confidence `verified`, cycle `now-1d … now+30d`, verifiedAt `now`, staleAt `now+1d`)
- Modify: `service/MarketplaceService.java` (`PUT /api/marketplaces/{id}/quotas`), `step/MarketplaceSteps.java`
- Modify: `verification/ProductDetailPageVerification.java`, `page/ProductDetailPage.java`
- Modify: `test/ui/PublicationJourneyUiTest.java`

**Interfaces:**
- Consumes: `ProductsPageSteps.createAndPublishFromWizard(String)` (Task 3), `ProductSteps.findProductIdsByName` (Task 3).
- Produces: `MarketplaceSteps.exhaustOlxQuota(AccountPojo account, String subcategoryId)` (asserts 200), `ProductDetailPageVerification.showsOlxFeeConfirmation()` (dialog with text `Confirm possible OLX fee`), `ProductVerification.listingOfProductIsNotPublished(AccountPojo, String name)` (listing status is not `active`/`published` and no external id).

- [ ] **Step 1: Write the test** `exhaustedQuotaAsksToConfirmTheOlxFee`: register, connect sandbox OLX, `marketplaceSteps.exhaustOlxQuota(account, "1001")`, sign in, `productsPageSteps.createAndPublishFromWizard(name)`, `productDetailPageSteps.verify().showsOlxFeeConfirmation()`, `productSteps.verify().listingOfProductIsNotPublished(account, name)`.
- [ ] **Step 2:** Run it — compile FAIL.
- [ ] **Step 3:** Implement. Read the exact listing status values in `src/shared/types` before writing `listingOfProductIsNotPublished`.
- [ ] **Step 4:** Run — PASS. If the dialog does not appear, read `GET /api/listings/{id}/publish-preview` on the stand: a non-quota warning disables override eligibility (`ListingController.ts:115`); report it rather than weaken the assertion.
- [ ] **Step 5:** `./gradlew check` — PASS. Commit `test(ui): confirm the OLX fee when the quota is exhausted`.

### Task 5: Double click sends one product

**Files:**
- Modify: `page/ProductsPage.java`, `step/ProductsPageSteps.java`, `test/ui/PublicationJourneyUiTest.java`

**Interfaces:**
- Produces: `ProductsPageSteps.publishToOlxTwiceAtOnce()` — `Selenide.executeJavaScript("arguments[0].click(); arguments[0].click();", page.publishToOlxButton())` after `shouldBe(enabled)`.

- [ ] **Step 1: Write the test** `doubleClickOnPublishCreatesOneProduct`: as Task 3 up to `publishToOlxIsEnabled()`, then `.backToSteps().publishToOlxTwiceAtOnce()`, `productDetailPageSteps.verify().showsPublicationQueued()`, `productSteps.verify().hasExactlyOneProductNamed(account, name)`.
- [ ] **Step 2:** Run — compile FAIL. Implement. Run — PASS.
- [ ] **Step 3:** `./gradlew check` — PASS. Commit `test(ui): publish once on a double click`.

### Task 6: Publish to OLX is visible on a phone without scrolling

**Files:**
- Modify: `page/ProductsPage.java`, `step/ProductsPageSteps.java`, `verification/ProductsPageVerification.java`, `test/ui/PublicationJourneyUiTest.java`

**Interfaces:**
- Produces: `ProductsPageSteps.useWindowSize(int width, int height)` — `WebDriverRunner.getWebDriver().manage().window().setSize(new Dimension(width, height))`; `ProductsPageVerification.publishToOlxIsFullyInViewport()` — JS on the button: `const r = arguments[0].getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;` must be `true`, polled until `getTimeout()`.

- [ ] **Step 1: Write the test** `publishToOlxFitsAPhoneScreen`: open the stand at 390×844 (after `signIn`, call `useWindowSize(390, 844)` and reload the products page), then wizard up to the review step with the fields filled and category chosen, `.verify().publishToOlxIsFullyInViewport()`.
- [ ] **Step 2:** Run — compile FAIL. Implement. Run — PASS.
- [ ] **Step 3:** Sanity check the assertion: temporarily use 390×400 and see it FAIL; restore.
- [ ] **Step 4:** `./gradlew check` — PASS. Commit `test(ui): keep Publish to OLX on a phone screen`.

### Task 7: Issue, design note and PR description

- [ ] **Step 1:** Open an issue in `quokkify/marketdesk`: "Jest test: the product page shows the full OLX rejection text" — the Playwright test it replaces, why it cannot run live (stub adapter answers 201, test hooks are an anti-goal), the component that renders `syncError`, and that the test belongs in Jest via `renderToStaticMarkup`. Ask the owner before creating it (outward-facing).
- [ ] **Step 2:** Update the issue number in the spec's verdict table; commit `docs: record the publication journey verdicts`, together with this plan and the spec.
- [ ] **Step 3:** Full run: `./gradlew check uiTest` — PASS (paste the summary). Then tear the stand down (`docker compose down --volumes --remove-orphans` with the same project name).
- [ ] **Step 4:** Push the branch; update the PR 500 body: the verdict table from the spec, the issue link, the dropped console check with its reason, test plan. Ask the owner before pushing.
