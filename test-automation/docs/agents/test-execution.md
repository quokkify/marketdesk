# Spec: test execution with q4j TestNG extensions

The template manages this file, and `copier update` refreshes it. It is the contract for how tests are
grouped and run in this project. An agent reads it to adopt the q4j TestNG extensions in a project that does
not have them yet (section 3), and before it adds a test set, a Gradle test task, or anything that runs
tests in parallel.

## 1. Intent

[`dev.quokkify:testng`](https://github.com/quokkify/q4j/tree/main/testng-extensions) runs every suite the same
way:
- `SuiteListener` rebuilds the TestNG suite into a parallel `Concurrency` block (`TEST_THREAD_COUNT` threads,
  one method per thread) and a one-thread `Sequential` block for `@SingleThread` tests.
- `RetryListener` re-runs a failed test up to `RETRY_COUNT` times.

The project does not write its own `testng.xml`, thread pools, or retry logic.

## 2. Requirements

| ID  | Requirement                                                                                                                                                                                                      | Check                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T1  | `gradle/libs.versions.toml` declares `q4j-testng` (`dev.quokkify:testng`, `version.ref = "q4j"`), and `gradle/dependencies.gradle` declares it as `implementation`.                                              | read both files                                                                        |
| T2  | `src/test/resources/META-INF/services/org.testng.ITestNGListener` lists `dev.quokkify.listener.lifecycle.SuiteListener` and `dev.quokkify.listener.retry.RetryListener`.                                          | read the file                                                                          |
| T3  | No `testng.xml` suite file, no `parallel` or `threadCount` in Gradle, and no `@Listeners` for these two listeners. Thread count and retries come from the environment or an optional `src/test/resources/testng.properties`. | `git ls-files '*testng*.xml'` prints nothing; `grep -rn parallel gradle` prints nothing |
| T4  | Test sets are selected by package, never by TestNG groups: no `@Test(groups = ...)`, no Gradle `includeGroups`/`excludeGroups`. | `grep -rnE '@Test\([^)]*groups *=' src/test` and `grep -rnE 'includeGroups\|excludeGroups' gradle` print nothing |
| T5  | A test that shares state with other tests, or needs exclusive use of an external resource, carries `@SingleThread`. Steps, services and verifications keep no per-test mutable state.                          | review                                                                                 |
| T6  | Gradle prints the generated suite: test names start with `Default suite > Concurrency >` or `Default suite > Sequential >` (or the `SUITE_NAME` you set).                                                     | `./gradlew test` output                                                                |
| T7  | `@Test` sits on each test method, declared in the concrete test class. | review: no class-level `@Test`, no `@Test` methods inherited from a base class |

Why T4: `SuiteListener` builds new `<test>` blocks from the selected classes and keeps only their methods.
The TestNG group filter that Gradle or a `@Test(groups)` attribute sets is not copied into them, so a group
split silently runs every test.

Why T7: `SuiteListener` collects the methods a class declares itself that carry `@Test`. A class-level `@Test`
or a test method inherited from a base class is never run, and nothing reports it.

## 3. Adoption procedure

Run it when `src/test/resources/META-INF/services/org.testng.ITestNGListener` does not list `SuiteListener`. If
the file is missing, `copier update` adds it. A file that already exists belongs to the project and is not
changed.

1. Add `q4j-testng = { module = "dev.quokkify:testng", version.ref = "q4j" }` to `[libraries]` in
   `gradle/libs.versions.toml` unless it is there, and `implementation libs.q4j.testng` to
   `gradle/dependencies.gradle` (T1).
2. Make sure the SPI file lists both listeners (T2). Keep any other listener the project registers.
3. Delete `testng.xml` suite files and any `@Listeners` for these listeners. Move thread and retry settings to
   `src/test/resources/testng.properties` (T3).
4. Replace TestNG groups (T4):
   - A Gradle task that runs one test set selects it by package:
     `include '**/test/api/**'` in that task, and `exclude '**/test/api/**'` in the task that must skip it.
   - Choosing a test set at run time with `@TestGroup("name")` and `TEST_GROUP=name` needs `SingleGroupListener`
     in the SPI file, listed before `SuiteListener`. TestNG does not guarantee the order of suite listeners, so
     confirm with T6 that only that set runs and that `@SingleThread` tests stay in `Sequential`.
   - Remove `groups = ...` from `@Test`.
5. A Gradle `Test` task whose package filter leaves it with no tests to run fails in Gradle 9. If that is
   expected, for example a `test` task while the project has no unit tests yet, set
   `failOnNoDiscoveredTests = false` on that task.
6. Mark tests that cannot run concurrently with `@SingleThread` (T5).
7. Run every test task once and check T6.

## 4. Settings

`TestNGExtension` reads these keys from the environment or an optional `src/test/resources/testng.properties`
(create it only to change a default).

| Key                               | Default         | Effect                                                         |
| --------------------------------- | --------------- | -------------------------------------------------------------- |
| `TEST_THREAD_COUNT`               | `5`             | Threads of the `Concurrency` block                             |
| `RETRY_COUNT`                     | `2`             | Re-runs of a failed test                                       |
| `SINGLE_THREAD_TESTS_IN_PARALLEL` | `false`         | Run the `Sequential` block alongside `Concurrency`             |
| `SUITE_NAME`                      | `Default suite` | Suite name in reports                                          |
| `TEST_GROUP`                      | unset           | With `SingleGroupListener`, run only that `@TestGroup`         |
| `TEST_PARALLEL_MODE`              | `METHODS`       | Parallel mode of `Concurrency` (environment variable only)     |
| `DATA_PROVIDER_THREAD_COUNT`      | TestNG default  | Data provider threads (environment variable only)              |
| `EXECUTION_MODE`                  | `LOCAL`         | `LOCAL`, `CI` or `DIND`, for code that branches on it          |

## 5. Acceptance criteria

- [ ] T1 to T5 and T7 hold.
- [ ] Every Gradle test task runs and prints `Concurrency` or `Sequential` in its test names (T6).
- [ ] A task meant to skip a test set does not run it. Check the test names it prints.
