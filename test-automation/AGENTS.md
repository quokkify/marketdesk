# Agent guide: writing tests here

Read this file before you add or change code in this project. The template (quokkify/java-test-automation-template) manages it, and `copier update` refreshes it. Put rules that apply only to this project in `AGENTS.project.md` in this folder, and read that file too if it exists.

## 1. Before you write code

1. Find the q4j version: the `q4j = "<version>"` line in `gradle/libs.versions.toml`.
2. Open the README of every q4j module you will use, at that version: `https://github.com/quokkify/q4j/blob/v<version>/<module path>/README.md`. Why: the q4j jars on the classpath contain no docs. The README is the contract for base classes, configs, and step patterns.
3. Search `src/main` for existing configs, services, steps, and verifications, and extend them. Do not write parallel ones. If `src/main` has none yet, create them with the layout in section 2. Never put them in a test class.

| Artifact (`dev.quokkify:`) | Module path                 | Extend                                         | Use or compose (do not extend)          |
| -------------------------- | --------------------------- | ---------------------------------------------- | --------------------------------------- |
| `config`                   | `common-utils/config`       | Owner `Config` (your own interfaces)           | `ConfigRegistry`                        |
| `testng`                   | `testng-extensions`         | `AbstractSteps`                                | listeners, `TestNGExtension` config     |
| `rest-assured`             | `integrations/rest-assured` | `ApiService`, `ApiSteps`, `BaseApiVerification`| `Configuration`, `ResponseHelper`       |
| `selenide`                 | `integrations/selenide`     | `Page`, `PageSteps`, `Verification`            | `BrowserConfiguration`                  |
| `sql`                      | `data-utils/sql`            | `AbstractDatabaseSteps`                        | `SqlDatabaseSteps`, `DatabaseConfig`    |
| `redis`                    | `data-utils/nosql/redis`    | —                                              | `RedisSteps`                            |
| `morphia`                  | `data-utils/nosql/morphia`  | `AbstractMongoSteps`                           | `MongoDatabaseSteps`                    |
| `kafka`                    | `integrations/kafka`        | —                                              | `KafkaProducerSteps`, `KafkaConsumerSteps` |
| `tyrus`                    | `integrations/tyrus`        | `AbstractWsSteps`, `BaseWsVerification`        | `WsSteps` (final), `WsConfiguration`    |
| `jackson-json`             | `common-utils/jackson/json` | —                                              | `JsonConverter` (final utility)         |

A class in the "Use or compose" column goes into your own steps class as a field. Do not subclass it.

For a module that is not listed here, look up its path in the [module catalog](https://github.com/quokkify/q4j#-module-catalog) and the `settings.gradle` of q4j.

Architecture verification has its own spec: [docs/agents/architecture-verification.md](docs/agents/architecture-verification.md). Read it when `build.gradle` does not apply `gradle/architecture.gradle`, because the gate is then not wired yet and the spec tells you how to add it. Read it also when `verifyArchitecture` reports a finding.

## 2. Where code goes

`src/main` holds the test framework: code that any test can reuse. `src/test` holds only tests. `<base>` is the base package `<package_root>.<package_name>` from `.copier-answers.yml`. The template generated every package below with a `package-info.java` that states its purpose. Put each class into the matching package. Do not create other top-level packages.

```text
src/main/java/<base>/
  config/        Owner interfaces (*Configuration, package-private) + one public *Config class per area
  model/         request/response models (*Pojo records; nested types as inner records)
  service/       *Service extends dev.quokkify.service.ApiService: endpoints, return ValidatableResponse
  helper/        optional: call a service, check status, deserialize into a model
  verification/  *Verification extends BaseApiVerification<Self> (or PageSteps Verification, ...)
  step/          *Steps extends ApiSteps<V> / PageSteps / AbstractDatabaseSteps; BaseSteps aggregates them
src/main/resources/   *.properties read by the Owner configs
src/test/java/<base>/test/
  BaseTest       extends BaseSteps; TestNG lifecycle (@BeforeClass/@AfterClass) only
  ...Test        @Test methods only; group by layer in sub-packages (test/api, test/ui, ...) when there are many
src/test/resources/   TestNG suites, META-INF/services listener registration
```

Declare a q4j module that `src/main` uses as `implementation` in `gradle/dependencies.gradle`. Use `testImplementation` only for test-only libraries such as TestNG. Why: `testImplementation` hides the module from `src/main`, and that pushes framework code into `src/test`.

Some q4j modules do not pass their own base types on to your build. `rest-assured` needs `dev.quokkify:testng` (for `AbstractSteps`) and `dev.quokkify:config` (for `ConfigRegistry`) declared as `implementation` too. If `src/main` fails to compile on a q4j type, add the module that contains that type.

If this project was generated before this file existed, it may still have `testImplementation libs.q4j.config` and config classes under `src/test`. Move them to `src/main` and switch the dependency to `implementation` before you add new code.

## 3. Rules

Each rule can be checked in review.

1. **Test classes contain only test methods and lifecycle methods.** No nested or private classes, no `RestAssured.given()`, no endpoint paths, no Hamcrest/JSON-path body checks. Why: anything inside a test class cannot be reused, and it bypasses the Allure steps that the report depends on.
2. **Every setting comes from an Owner config read through `ConfigRegistry`.** This covers base URIs, credentials, timeouts, and feature flags. Never use `System.getProperty`, `System.getenv`, or hard-coded URLs in Java code. Why: Owner already merges system properties, environment variables, and properties files, so one key works locally and in CI.
3. **Reuse the configs that q4j ships before you add a key.** Examples: `dev.quokkify.config.Configuration` from `rest-assured` (`MAX_RESPONSE_TIME_SECONDS`, which `ApiService` already reads), `DatabaseConfig` from `sql` (`SQL_DATABASE_*`), `BrowserConfiguration` from `selenide` (`BROWSER*`), and `WsConfiguration` from `tyrus` (`WS_URL`). Add your own config only for keys that are specific to this project.
4. **One entry point per config area.** Make the Owner interface `*Configuration` package-private, and expose its values through one `public final` `*Config` class, like `<base>.config.StarterConfig`. Values that must change at runtime use `ConfigRegistry.getReloadable` and `ConfigRegistry.overlay` instead of `static final` constants.
   Do not name your properties files after the ones q4j ships (`api-config.properties`, `browser.properties`, and others), because the same name on the classpath shadows the q4j file.
5. **Services only send requests.** A `*Service` extends `ApiService`, builds the request spec from config, keeps endpoint paths as constants, and returns `ValidatableResponse`. It makes no assertions.
6. **Steps act; verifications assert.** A `*Steps` class extends the q4j base for its layer. It sets `verification` in its constructor and marks every public action with `@Step`. Assertions go in a `*Verification` class with `@Step` methods that return `self()` so calls can chain.
7. **`BaseSteps` owns the steps fields.** `BaseSteps` lives in `<base>.step` (generated empty) and declares one `protected final` field per steps class, for example `apiSteps`. `BaseTest` extends `BaseSteps`, and tests use those fields.
8. **Tests read as the scenario:** `apiSteps.action(...)` and then `apiSteps.verify().expectation(...)`.

## 4. API example

```java
// src/main/java/<base>/config/ApiConfiguration.java
@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:api.properties"})
interface ApiConfiguration extends Config {
  @Key("API_BASE_URI") String baseUri();
}

// src/main/java/<base>/config/ApiConfig.java
public final class ApiConfig {
  private static final ApiConfiguration CONFIG = ConfigRegistry.get(ApiConfiguration.class);
  public static final String BASE_URI = CONFIG.baseUri();
  private ApiConfig() {
  }
}

// src/main/java/<base>/service/HealthService.java
public class HealthService extends ApiService {
  private static final String HEALTH = "/health";

  public ValidatableResponse getHealth() {
    return get(RestAssured.given().spec(getRequestSpecification(ApiConfig.BASE_URI, ContentType.JSON)), HEALTH);
  }
}

// src/main/java/<base>/verification/HealthVerification.java
public class HealthVerification extends BaseApiVerification<HealthVerification> {
  @Override
  protected HealthVerification self() {
    return this;
  }

  @Step("Health status is {expected}")
  public HealthVerification hasStatus(ValidatableResponse response, String expected) {
    response.body("status", Matchers.equalTo(expected));
    return self();
  }
}

// src/main/java/<base>/step/HealthSteps.java
public class HealthSteps extends ApiSteps<HealthVerification> {
  private final HealthService service = new HealthService();

  public HealthSteps() {
    this.verification = new HealthVerification();
  }

  @Step("Get health")
  public ValidatableResponse getHealth() {
    return service.getHealth();
  }
}

// src/main/java/<base>/step/BaseSteps.java
public abstract class BaseSteps {
  protected final HealthSteps healthSteps = new HealthSteps();
}

// src/test/java/<base>/test/BaseTest.java
public abstract class BaseTest extends BaseSteps {
}

// src/test/java/<base>/test/api/HealthTest.java
public class HealthTest extends BaseTest {
  @Test(groups = "api")
  public void reportsLiveness() {
    ValidatableResponse response = healthSteps.getHealth();
    healthSteps.verify().verifyResponseStatusCode(response, 200).hasStatus(response, "ok");
  }
}
```

UI and database tests follow the same layers. For UI, write a `<Name>Page`, a `<Name>Verification`, and `<Name>PageSteps extends PageSteps`. For a database, write `<Name>DbSteps extends AbstractDatabaseSteps`. The exact generics are in the module README.

## 5. Done checklist

- [ ] `./gradlew assemble testClasses checkstyleMain checkstyleTest spotbugsMain spotbugsTest verifyArchitecture` passes.
- [ ] `grep -rnE 'RestAssured|System\.(getProperty|getenv)' src/test/java` prints nothing.
- [ ] No base URI or host is hard-coded in `src/test/java`; it comes from a `*Config` class.
- [ ] Every new class under `src/test/java` is a test class or `BaseTest`, and none contains a nested class.
- [ ] Every new setting has a key in an Owner config and a default or example value in `src/main/resources`.
