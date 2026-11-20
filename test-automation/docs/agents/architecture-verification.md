# Spec: architecture verification

The template manages this file, and `copier update` refreshes it. It is the contract for the
`archgateCheck` build gate. An agent reads it in two cases: to adopt the gate in a project that does not
have it yet (section 3), and to fix a finding the gate reports (section 4).

## 1. Intent

Code review used to be the only place that caught project contracts, such as a test class that TestNG never
runs or a `System.out` call in framework code. `archgateCheck` checks them on every build with the
[ArchGate](https://github.com/quokkify/archgate) Gradle plugin `dev.quokkify.archgate`: rules listed in a
plain text file, one report. A finding at `ERROR` fails `./gradlew check`.

## 2. Requirements

Each requirement can be checked with a file read or a command.

| ID  | Requirement                                                                                                                                                                                                                     | Check                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | The Gradle wrapper is 9.7.1 or later, the oldest version the plugin supports.                                                                                                                                                  | read `distributionUrl` in `gradle/wrapper/gradle-wrapper.properties` |
| R2  | `gradle/libs.versions.toml` declares the `archgate` version, the library `archgate-bom` (`dev.quokkify.archgate:archgate-bom`, `version.ref = "archgate"`) and the plugin `archgate` (`dev.quokkify.archgate`, `version.ref = "archgate"`). | read the three tables                                    |
| R3  | `build.gradle` applies `alias(libs.plugins.archgate)` and sets `archgate { rootPackage = '<package_root>.<package_name>'; failOn = 'ERROR' }` from `.copier-answers.yml`.                                                     | read `build.gradle`                                      |
| R4  | `gradle/dependencies.gradle` declares `testImplementation platform(libs.archgate.bom)` and `testImplementation 'dev.quokkify.archgate:archgate-rules-archunit'`.                                                              | read `dependencies { }`                                  |
| R5  | `src/test/resources/META-INF/services/dev.quokkify.archgate.api.ArchitectureRule` lists at least the six rules in section 4.                                                                                                   | read the file                                            |
| R6  | `./gradlew check` runs `archgateCheck`, and CI runs `check` or `archgateCheck` on every pull request.                                                                                                                           | `./gradlew check --dry-run \| grep archgateCheck`        |
| R7  | A finding is fixed in the code. Never remove a rule, never lower the gate with `failOn`, `-Parchgate.failOn` or `-Parchgate.skip`, and never take `archgateCheck` out of `check` to make a build pass.                       | review the diff of `build.gradle` and the services file  |
| R8  | Nothing of the old q4j gate is left: no `gradle/architecture.gradle`, `tools/architecture/`, `verifyArchitecture`, `architecture.packages`, or `q4j-architecture` catalog entry.                                             | section 3, step 1                                        |

The rules run only when the services file lists them (opt-in), and a public rule class in the project that
the file does not list fails the build (fail-closed). To change a built-in rule's parameter or severity,
subclass it and list the subclass instead of the original; build settings do not configure rules. Rules
specific to this project belong in a `<project>-archgate-rules` module, not in the template files. The
plugin documentation explains both: [configuration](https://github.com/quokkify/archgate/blob/main/docs/configuration.md)
and [writing a rule](https://github.com/quokkify/archgate/blob/main/docs/extending.md).

## 3. Adoption procedure

Run it when `build.gradle` does not apply `libs.plugins.archgate`. Only a new project gets the gate wired.
In an existing project, `copier update` adds the services file and refreshes this spec. It does not change
`build.gradle`, `gradle/dependencies.gradle` or the version catalog, because those belong to the project
after the first generation. `<ref>` below is the `_commit` value of `.copier-answers.yml`, the template
version that delivered this file. If that value is not a release tag (it then looks like
`v2.0.0-3-gabc1234`), use the latest release tag of the template instead.

An update from a template version before 2.0.0 also runs a Copier migration, which Copier runs only with
`copier update --trust`. The migration removes the old q4j gate (step 1) and nothing else, so after it the
project has no architecture gate at all until this procedure is done.

1. Remove the old q4j gate (R8), if any of it is left. The migration does this and prints a `WARNING` line
   for each thing it left to you; check its output, and do by hand what is still there:
   - delete every line that applies `gradle/architecture.gradle` from the Gradle scripts;
   - delete `gradle/architecture.gradle` and the `tools/architecture/` directory. Before you delete
     `tools/architecture/`, note every rule its services file lists other than the five template rules
     (`JavaConventionsRule`, `NoConsoleOutputRule`, `NoDeprecatedApiRule`, `ServiceRegistrationRule`,
     `TestClassNamingRule`); step 6 ports them;
   - replace every `verifyArchitecture` in Gradle scripts (`dependsOn`, `finalizedBy`, task lists) with
     `archgateCheck`, or delete the reference until step 4 applies the plugin;
   - delete `architecture.packages` and `architecture.fail.on` from `gradle.properties`, and the file if
     nothing else is left in it;
   - delete `q4j-architecture`, `log4j-core` and `log4j-slf4j2-impl` from `[libraries]` of
     `gradle/libs.versions.toml`, and `log4j` from `[versions]`, unless a build script, a `[bundles]` entry
     or another library still uses them.

   Then run `./gradlew assemble testClasses`, and fix what fails before you go on.
2. Check the wrapper (R1). If it is older than 9.7.1, run
   `./gradlew wrapper --gradle-version <the version in template/gradle/wrapper/gradle-wrapper.properties at <ref>>`.
3. Add to `gradle/libs.versions.toml` (R2), after the existing entries of each table. Take the version from
   `https://raw.githubusercontent.com/quokkify/java-test-automation-template/<ref>/template/gradle/libs.versions.toml`:

   ```toml
   [versions]
   archgate = "<version>"

   [libraries]
   archgate-bom = { module = "dev.quokkify.archgate:archgate-bom", version.ref = "archgate" }

   [plugins]
   archgate = { id = "dev.quokkify.archgate", version.ref = "archgate" }
   ```

4. In `build.gradle` (R3), add `alias(libs.plugins.archgate)` as the last line of the `plugins { }` block,
   and append this block after the `apply from` lines. `<base>` is `<package_root>.<package_name>` from
   `.copier-answers.yml`:

   ```groovy
   archgate {
       rootPackage = '<base>'
       failOn = 'ERROR'
   }
   ```

5. Add to the `dependencies { }` block of `gradle/dependencies.gradle` (R4):

   ```groovy
   testImplementation platform(libs.archgate.bom)
   testImplementation 'dev.quokkify.archgate:archgate-rules-archunit'
   ```

6. Check that `src/test/resources/META-INF/services/dev.quokkify.archgate.api.ArchitectureRule` exists (R5).
   If it does not, copy it from
   `https://raw.githubusercontent.com/quokkify/java-test-automation-template/<ref>/template/src/test/resources/META-INF/services/dev.quokkify.archgate.api.ArchitectureRule`.
   If step 1 found rules of the old gate that the template did not list, write an ArchGate rule for each in
   `src/test/java` (or a `<project>-archgate-rules` module) and list it in this file.
7. Run `./gradlew archgateCheck`. Fix every `ERROR` finding as section 4 describes, then fix the `WARNING`
   findings or list them in the change description. A run without findings needs nothing more.
8. Make sure CI runs `check` or `archgateCheck` (R6). If CI runs only named tasks, such as
   `assemble testClasses checkstyleMain`, add `archgateCheck` to that list, in place of `verifyArchitecture`
   if it is there. If the project has no CI configuration, the CI half of R6 does not apply; say so in the
   change description.
9. Check every box in section 5 before you hand the change over.

## 4. Rules and fixes

`MAIN` means the classes of `src/main`. `TEST` means the classes of `src/test`. The report prints this scope
next to each rule. Every rule is in `dev.quokkify.archgate.rules.archunit`, and its page in the
[ArchGate rule docs](https://github.com/quokkify/archgate/tree/main/docs/rules) shows a violation and a fix.

| Rule                         | Scope     | Severity | Finding means                                                                                                                                         | Fix                                                                                         |
| ---------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `HashCodeEqualsTogetherRule` | MAIN      | ERROR    | A class overrides only one of `equals` and `hashCode`.                                                                                                | Override both methods, or use a record.                                                     |
| `LoggerFieldNameRule`        | MAIN      | ERROR    | A Log4j2 or SLF4J logger field is not named `LOG`, or is not `static final`.                                                                         | Declare it `private static final Logger LOG`.                                               |
| `NoConsoleOutputRule`        | MAIN      | ERROR    | Framework code writes to `System.out` or `System.err`, calls `printStackTrace()`, or calls `Thread.dumpStack()`.                                     | Log through a `LOG` field, or attach the value to the Allure step.                          |
| `NoDeprecatedApiUsageRule`   | MAIN+TEST | WARNING  | Code uses a deprecated class, method or field, from q4j or any other library.                                                                         | Switch to the replacement that the deprecation Javadoc names.                               |
| `ServiceRegistrationRule`    | MAIN+TEST | ERROR    | A `META-INF/services` file names a type that cannot be loaded, or a provider that does not implement the service, is not a public concrete class, or has no public no-argument constructor. | Fix the provider class or the registration line.                                            |
| `TestClassNamingRule`        | TEST      | ERROR    | A class with TestNG `@Test` methods has a name that does not end in `Test`, so name-based test selection skips it.                                  | Rename the class, or move shared code into a support class without `@Test` methods.         |

A run that cannot verify anything fails whatever `failOn` says, for example when no class is compiled under
`rootPackage` or no TestNG test class exists. Fix the cause the error message names. The report is also
written to `build/reports/archgate/report.txt`; read it when the task is `UP-TO-DATE` or `FROM-CACHE`, because
the console report is printed only when the task runs.

## 5. Acceptance criteria

- [ ] R1 to R6 and R8 hold.
- [ ] `./gradlew archgateCheck` prints `Gate PASSED`.
- [ ] `./gradlew check --dry-run` lists `:archgateCheck` (a dry run prints every task as `SKIPPED`).
- [ ] The diff does not remove rules already listed in the services file, and does not add `failOn` values
      other than `ERROR`, `archgate.failOn` or `archgate.skip` anywhere (R7).
