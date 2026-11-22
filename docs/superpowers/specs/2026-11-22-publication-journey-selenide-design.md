# Finish the publication journey move to Selenide

Date: 2026-11-22. Status: approved by the owner. Follows `2026-11-13-java-test-migration-design.md` (pull request 4 of
that plan: the UI test and the Playwright removal).

## Intent

Pull request 500 deletes `tests/visual/publication-journey.spec.ts` (seven tests) but ports only the last one to
`PublicationJourneyUiTest`. The owner's review asks for one unbroken fluent chain per page object, and for every
other finding of the review to be fixed in the same branch (`chore/remove-playwright`).

## Goals

1. Every one of the seven Playwright tests gets a verdict from the 2026-11-13 design (*moves*, *stays*, *dropped*),
   and each *moves* verdict has a passing Selenide test against the live Compose stack.
2. Every UI test in `test-automation` chains steps and verifications of one page object without restarting:
   `steps.action().verify().check().backToSteps().nextAction()...`. A new chain starts only when the page object
   changes.
3. The other review findings are fixed (listed under Design).

## Non-goals

- Changing q4j, the template or ci-kit.
- New test-only routes or switches in the application (anti-goal of the 2026-11-13 design).
- Visual regression: the three files in `docs/screenshots/issue-290` stay static, as already decided.

## Verdicts for the seven Playwright tests

| Playwright test | Verdict | Where |
|---|---|---|
| creates and queues an advert from photos and review without a second dialog | *moves* | `PublicationJourneyUiTest.newProductIsQueuedFromTheWizard`: upload a PNG, fill name, description, price, pick the stub OLX category, Publish to OLX; the product page shows "Publication was accepted and queued." and no dialog. The API then shows one product, its listing with the chosen category, and a publish in progress. Request order and request bodies are not observable from outside; the end state replaces them. |
| opens the publication review when the preview needs a quota confirmation | *moves* | Set an exhausted quota (`consumed = publicationLimit`) for the stub category through `PUT /api/marketplaces/:id/quotas`, run the wizard, expect the product page dialog "Confirm possible OLX fee" and a listing that is still not published. |
| shows the full failure text when OLX rejects the queued advert | *stays* (owner: issue, no test in this PR) | The stub adapter always answers 201 and test hooks are an anti-goal. An issue is opened for a Jest unit test of the component that renders `syncError`; the pull request description names it. |
| sends one product when Publish to OLX is pressed twice quickly | *moves* | Two clicks in one script call, as before; the API then lists exactly one product with that name. |
| keeps Publish to OLX disabled without a price or while the category changes | *dropped* | Covered by `ProductWizardForm.test.tsx` ("keeps Publish to OLX disabled at price 0 and names the reason", "blocks publishing while the chosen category is being changed"). |
| on a phone: shows Publish to OLX without scrolling | *moves* | Window set to 390×844 for that test only; a script checks that the button's bounding box lies fully inside the viewport. |
| shows review-only assistance and the manual publication review | *moves* (already in PR 500) | `PublicationJourneyUiTest.creationEntryAndReviewOnlyAssistanceAreVisible`, rechained. Its console check for "does not recognize the" is *dropped*: the stack serves the production build, where React never prints that warning, so the check could not fail. |

## Design

- **Chains.** Use `Verification.backToSteps()` (q4j, already on the classpath) in every UI test class. Separate
  commit `refactor(test): chain page steps through backToSteps`.
- **Wizard steps.** New `ProductsPageSteps` methods for the wizard (upload photos, continue, fill review fields,
  choose OLX category, publish) and a `ProductsPageVerification`/`ProductDetailPageVerification` pair for the
  outcomes. Locators by role, label and visible text, as the existing page objects do. The photo is a small PNG
  under `src/test/resources` (or `src/main/resources` if the layout rules require it), uploaded with Selenide's
  `uploadFile`, which works through the Grid.
- **Quota setup.** A `MarketplaceSteps` API step that sets the exhausted quota, built on the existing service layer.
- **New product dialog close.** `closeNewProductDialog` is followed by a verification that the dialog is gone.
- **Duplicate category call.** `ListingSteps.publishSandboxOlxListing` reuses `setSandboxOlxCategory`.
- **Fragile locators.** `suggestedImprovementsHeading`, `suggestedPriceHeading` and `reviewOnlyNote` stop depending on
  `h6`/`span`; they match by text inside the Hermes card.
- **Dialog selector.** `[role="dialog"]` is declared in two page objects. Follow the existing convention: if the
  module has a shared locator holder, move it there; if every page object keeps its own constants, leave it (the
  review nit is withdrawn).
- **Catalogue table (added by the owner during implementation).** The products catalogue goes through the q4j
  `Table` helper (`Table.of(root, TableLayout.html())`, q4j 0.16.0): rows are found inside the Product column,
  cells are addressed by header (Updated, AI) instead of `td:nth-child`, column checks and the "listed once" check
  read the table in one browser call (`shouldSatisfy`).
- **Pull request description.** Carries the verdict table above and links the issue for the rejection test.

## Verification

- `./gradlew check` in `test-automation` (Checkstyle, SpotBugs, `verifyArchitecture`) with JDK 21.
- The UI tests run in CI (`scripts/ci-java-api-tests.sh`, `uiTest`), all of them, because the chain refactor touches
  every UI test. The owner chose not to run them locally: the owner's own Compose stack holds the fixed container
  names, so an isolated stand cannot run next to it.
- One reviewer pass over the finished branch.

## Left to the builder

- Exact method and locator names, following the existing page objects.
- Which stub taxonomy category the wizard search returns, and its subcategory id for the quota row.
