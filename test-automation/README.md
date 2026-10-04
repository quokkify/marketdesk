# Test automation

Standalone Java 21 Gradle project for tests built on [q4j](https://github.com/quokkify/q4j) configuration and TestNG. The starter only demonstrates configuration wiring; replace it with your API, UI, or integration checks.

## Prerequisites

JDK 21. The Gradle wrapper downloads Gradle itself.

## Commands

Compile and run Checkstyle and SpotBugs without running tests:

```sh
./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest
```

Run the tests:

```sh
./gradlew test
TEST_MESSAGE="Environment override" ./gradlew test
./gradlew -DTEST_MESSAGE="System property override" test
```

`example.TestConfig` reads system properties, then environment variables, then `src/test/resources/test.properties`. Access it with `ConfigRegistry.get(TestConfig.class)`.

## Add q4j modules

Pick modules from the [module catalog](https://github.com/quokkify/q4j#-module-catalog). Add each one to `gradle/libs.versions.toml` using the existing `q4j` version reference, then declare it in `gradle/dependencies.gradle`.

## File ownership

After the first generation the build, Gradle scripts, version catalog, wrapper, tool configs, sources, and `settings.gradle` belong to your project and are never overwritten. Only this README (and `.copier-answers.yml`) is refreshed by template updates.

## First-day checklist

- [ ] Run the compile command above with JDK 21.
- [ ] Run `./gradlew test`.
- [ ] Replace `example.StarterTest` and `example.TestConfig` with real tests.
- [ ] Add the compile command to your CI with JDK 21; decide when to run tests.
- [ ] Commit `.copier-answers.yml`; it is needed for updates.

If the repository also uses [quokkify/ci-kit](https://github.com/quokkify/ci-kit), add `java` to its `renovate_presets` answer so Renovate maintains these dependencies, and add the compile command to its own CI.

## Update the template

From inside this folder:

```sh
copier update --vcs-ref "$(gh release view --repo quokkify/java-test-automation-template --json tagName --jq .tagName)"
```
