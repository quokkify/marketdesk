# Spec: architecture verification

The template manages this file, and `copier update` refreshes it. It is the contract for the
`verifyArchitecture` build gate. An agent reads it in two cases: to adopt the gate in a project that does not
have it yet (section 3), and to fix a finding the gate reports (section 4).

## 1. Intent

Code review used to be the only place that caught project contracts, such as a test class that TestNG never
runs or a `System.out` call in framework code. `verifyArchitecture` checks them on every build with
[`dev.quokkify:architecture`](https://github.com/quokkify/q4j/tree/main/architecture): one runner, rules
registered in a plain text file, and one report. A finding at `ERROR` fails `./gradlew check`.

## 2. Requirements

Each requirement can be checked with a file read or a command.

| ID  | Requirement                                                                                                                                                                                              | Check                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| R1  | `gradle/libs.versions.toml` sets `q4j` to `0.9.0` or later, the first release that ships `architecture`.                                                                                                | read the `q4j = "..."` line                                      |
| R2  | The version catalog declares `q4j-architecture` (`dev.quokkify:architecture`, `version.ref = "q4j"`), `log4j-core` and `log4j-slf4j2-impl` (both `org.apache.logging.log4j`, `version.ref = "log4j"`). | read `[libraries]`                                               |
| R3  | `gradle/architecture.gradle` is byte-identical to the template file of the same template version, and `build.gradle` applies it with `apply from: 'gradle/architecture.gradle'`.                    | `diff` against the template file (section 3, step 2)             |
| R4  | `gradle.properties` sets `architecture.packages` to the base package `<package_root>.<package_name>` from `.copier-answers.yml`.                                                                        | `grep architecture.packages gradle.properties`                   |
| R5  | `tools/architecture/META-INF/services/dev.quokkify.architecture.contract.ArchitectureRule` lists at least the five rules in section 4, and `tools/architecture/log4j2.xml` exists.                   | read both files                                                  |
| R6  | `./gradlew check` runs `verifyArchitecture`, and CI runs `check` or `verifyArchitecture` on every pull request.                                                                                         | `./gradlew check --dry-run \| grep verifyArchitecture`           |
| R7  | A finding is fixed in the code. Never remove a rule, never lower the gate with `-Parchitecture.fail.on`, and never take `verifyArchitecture` out of `check` to make a build pass.                      | review the diff of `tools/architecture` and `gradle/`            |

Why R3 asks for an identical file: the template owns the wiring, so a fix to it reaches every project
through the same diff. Project-specific settings go in `gradle.properties` (R4), not in the script. When the
base package is renamed, update `architecture.packages` in the same change.

The gate parses Java sources only. A project with Kotlin, Groovy or Scala classes under
`architecture.packages` makes the run abort; do not adopt the gate there, and report it instead.

## 3. Adoption procedure

Run it when `build.gradle` has no `apply from: 'gradle/architecture.gradle'` line. Only a new project gets
the gate wired. In an existing project, `copier update` adds the files that are missing, usually
`gradle/architecture.gradle`, `gradle.properties` and `tools/architecture/`. It does not change
`build.gradle` or the version catalog, because those belong to the project after the first generation.
`<ref>` below is the `_commit` value of `.copier-answers.yml`, the template version that delivered this file.
If that value is not a release tag (it then looks like `v1.2.0-3-gabc1234`), use the latest release tag of
the template instead.

1. Raise q4j to `0.9.0` or later in `gradle/libs.versions.toml` (R1). Then run
   `./gradlew assemble testClasses`, and fix what fails before you go on. In a project generated before
   `AGENTS.md` existed, the usual failure is `src/main` not seeing q4j: apply the `testImplementation` to
   `implementation` rule in section 2 of `AGENTS.md`.
2. Each of these files must match
   `https://raw.githubusercontent.com/quokkify/java-test-automation-template/<ref>/template/<path>` at the same
   `<path>`. Copy a missing file from there. Compare a file that exists with that one, and replace it when it
   differs. Do not edit them.
   - `gradle/architecture.gradle`
   - `tools/architecture/log4j2.xml`
   - `tools/architecture/META-INF/services/dev.quokkify.architecture.contract.ArchitectureRule`
3. Add to `gradle/libs.versions.toml` (R2), after the existing entries of each table. Under `[versions]`,
   add `log4j = "2.26.1"` unless the catalog already has a `log4j` version. Under `[libraries]`, add:

   ```toml
   q4j-architecture = { module = "dev.quokkify:architecture", version.ref = "q4j" }
   log4j-core = { module = "org.apache.logging.log4j:log4j-core", version.ref = "log4j" }
   log4j-slf4j2-impl = { module = "org.apache.logging.log4j:log4j-slf4j2-impl", version.ref = "log4j" }
   ```

4. Append `apply from: 'gradle/architecture.gradle'` to `build.gradle` after the other `apply from` lines
   (R3).
5. Check that `gradle.properties` contains `architecture.packages=<package_root>.<package_name>` (R4), and add
   the line only if it is missing. The update creates the file with this line only when the project had no
   `gradle.properties`.
6. Run `./gradlew verifyArchitecture`. Fix every `ERROR` finding as section 4 describes, then fix the
   `WARNING` findings or list them in the change description. A run without findings needs nothing more.
7. Make sure CI runs `check` or `verifyArchitecture` (R6). If CI runs only named tasks, such as
   `assemble testClasses checkstyleMain`, add `verifyArchitecture` to that list. If the project has no CI
   configuration, the CI half of R6 does not apply; say so in the change description.
8. Check every box in section 5 before you hand the change over.

## 4. Rules and fixes

`MAIN` means classes and sources under `src/main`. `TEST` means every other source set. `RESOURCES` means
the resource directories of both. The report prints this scope next to each rule.

| Rule (report name)                                         | Scope     | Severity | Finding means                                                                                                                                                                             | Fix                                                                                                                      |
| ---------------------------------------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `JavaConventionsRule` (Java conventions (Taikai))          | MAIN+TEST | ERROR    | A class overrides only one of `equals` and `hashCode`; a `serialVersionUID` is not `static final long`; a package name breaks the Java convention; an interface name starts with `I`; a Log4j or SLF4J logger field is not named `LOG`. | Override both methods, or use a record. Fix the field, the package or the interface name. Rename the logger field to `LOG`. |
| `NoConsoleOutputRule` (No console output in main code)     | MAIN      | ERROR    | Framework code writes to `System.out` or `System.err`, calls `printStackTrace()`, or calls `Thread.dumpStack()`.                                                                          | Log through a `LOG` field, or attach the value to the Allure step.                                                       |
| `NoDeprecatedApiRule` (No deprecated API usage (Taikai))   | MAIN+TEST | WARNING  | Code uses a deprecated class, method or field, from q4j or any other library.                                                                                                              | Switch to the replacement that the deprecation Javadoc names.                                                            |
| `ServiceRegistrationRule` (Service registrations resolve)  | RESOURCES | ERROR    | A `META-INF/services` file names a type that cannot be loaded, or lists a provider that does not implement the service, is not a public concrete class, or has no public no-argument constructor. | Fix the provider class or the registration line.                      |
| `TestClassNamingRule` (Test class naming)                  | TEST      | ERROR    | A class with TestNG `@Test` methods has a name that does not end in `Test`, so name-based test selection skips it.                                                                       | Rename the class, or move shared code into a support class without `@Test` methods.                                      |

The report lists the shared models first, with their build times. Rule times are the rule's own work, so
the rule times do not add up to the total. A run that cannot verify anything aborts instead of passing, for
example when no TestNG test class is compiled. Fix the cause the error message names.

## 5. Acceptance criteria

- [ ] R1 to R6 hold.
- [ ] `./gradlew verifyArchitecture` prints `Gate: fail on ERROR -> passed`.
- [ ] `./gradlew check --dry-run` lists `:verifyArchitecture` (a dry run prints every task as `SKIPPED`).
- [ ] The diff does not touch rules already listed in `tools/architecture`, and does not add
      `architecture.fail.on` anywhere (R7).
