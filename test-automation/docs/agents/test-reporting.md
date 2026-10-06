# Spec: Allure test reporting

The template manages this file, and `copier update` refreshes it. It is the contract for how test results reach
the Allure report. An agent reads it to adopt the reporting in a project that does not have it yet (section 3),
and when a report is missing tests or steps (section 4).

## 1. Intent

Every test run writes Allure results that CI publishes as one report:
- `allure-testng`, which `dev.quokkify:testng` brings, writes one result per test;
- the AspectJ agent weaves the q4j `@Step` methods of steps and verifications, and the REST Assured attachments,
  into each result;
- CI uploads the results directory as an artifact that the report workflow collects.

A test that runs but is missing from the report, or appears without its steps, is a defect of this setup.

## 2. Requirements

| ID  | Requirement                                                                                                                                                                                        | Check                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A1  | `gradle/libs.versions.toml` declares `aspectj` and `aspectj-weaver` (`org.aspectj:aspectjweaver`, `version.ref = "aspectj"`), and the project depends on `dev.quokkify:testng`.                   | read the catalog and `gradle/dependencies.gradle`                         |
| A2  | `gradle/allure.gradle` is byte-identical to the template file of the same template version, and `build.gradle` applies it with `apply from: 'gradle/allure.gradle'`.                              | `diff` against the template file (section 3, step 2)                       |
| A3  | Every Gradle `Test` task runs with the AspectJ agent and writes results to `build/allure-results`. No project code sets `allure.results.directory` elsewhere.                                     | after `./gradlew test`, `build/allure-results/*-result.json` exist         |
| A4  | A test that calls q4j steps has those steps in its result.                                                                                                                                        | a `*-result.json` of such a test has a non-empty `steps` array             |
| A5  | CI uploads `build/allure-results` of every job that runs tests, as an artifact whose name the report workflow collects, for example the `allure-results-` prefix of quokkify/ci-kit.                | the report of a CI run lists the tests of every Gradle test task           |
| A6  | `allure-results/` is in `.gitignore`, and no results are committed.                                                                                                                                | `git ls-files '*allure-results*'` prints nothing                           |

## 3. Adoption procedure

Run it when `build.gradle` has no `apply from: 'gradle/allure.gradle'` line. `copier update` adds
`gradle/allure.gradle` when it is missing, but it does not change `build.gradle` or the version catalog. `<ref>`
is the `_commit` value of `.copier-answers.yml`, or the latest release tag if that value is not a tag.

1. Add to `gradle/libs.versions.toml`: `aspectj = "1.9.25.1"` under `[versions]`, and
   `aspectj-weaver = { module = "org.aspectj:aspectjweaver", version.ref = "aspectj" }` under `[libraries]` (A1).
2. Make `gradle/allure.gradle` match
   `https://raw.githubusercontent.com/quokkify/java-test-automation-template/<ref>/template/gradle/allure.gradle` and
   append `apply from: 'gradle/allure.gradle'` to `build.gradle` (A2).
3. Remove any other `-javaagent` for AspectJ and any `allure.results.directory` setting (A3).
4. Add `allure-results/` to `.gitignore` and delete committed results (A6).
5. In CI, upload `test-automation/build/allure-results` (relative to the repository root) after the tests, even
   when they fail, under the artifact name the report workflow collects (A5). With quokkify/ci-kit `java-ci.yml`:
   `upload-test-artifacts: true`, `test-artifact-path: build/allure-results`,
   `test-artifact-name: allure-results-<project>`.
6. Run the tests and check A3 and A4.

## 4. Diagnosing a report

| Symptom                                      | Cause                                                                    | Fix                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| No tests of a job in the report              | CI does not upload that job's results, or the artifact name is not collected | A5                                 |
| Tests without steps                          | the AspectJ agent is not on the test JVM                                 | A2, A3                                 |
| Results from an earlier local run reappear   | `build/allure-results` keeps results until `./gradlew clean`             | run `clean` before a local report      |
| A test runs but has no result                | it is not a TestNG test, or `allure-testng` is missing from the classpath | A1                                     |

## 5. Acceptance criteria

- [ ] A1 to A6 hold.
- [ ] A local `./gradlew clean test` leaves one `*-result.json` per test in `build/allure-results`.
- [ ] The CI report lists the tests of every test task, with their steps.
