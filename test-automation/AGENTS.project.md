# Project rules: MarketDesk test automation

Read after [AGENTS.md](AGENTS.md). These facts are specific to this project; the template README still shows the
starter names (`StarterConfig`, `starter.properties`, `TEST_MESSAGE`), which this project does not have.

- Base package: `dev.quokkify.marketdesk`.
- API base URI: Owner key `MARKETDESK_API_BASE_URI`, read through `config.MarketDeskApiConfig.BASE_URI`, default in
  `src/main/resources/marketdesk-api.properties` (`http://127.0.0.1:3000`). Override it as an environment variable or
  with `./gradlew apiTest -DMARKETDESK_API_BASE_URI=...`; `gradle/tests.gradle` forwards the system property.
- Live HTTP tests live in the `test.api` package and run only in `./gradlew apiTest`; `./gradlew test` excludes that
  package (see [docs/agents/test-execution.md](docs/agents/test-execution.md) for why not TestNG groups).
- `apiTest` needs the Compose stack. [`../scripts/ci-java-api-tests.sh`](../scripts/ci-java-api-tests.sh) starts it
  the way CI does. The stack needs a base64 32-byte `MARKETPLACE_CREDENTIALS_KEY`; without it Compose refuses to
  start the app (the script exports a throwaway key).
- Tests run in parallel through the q4j `SuiteListener` (see [docs/agents/test-execution.md](docs/agents/test-execution.md));
  keep steps and services free of per-test state, and mark a test that needs exclusive use of the stack with
  `@SingleThread`.
- `verifyArchitecture` runs `HttpStatusConstantRule`: tests in `test.api` pass statuses as `HttpStatus` constants, and
  the build fails on a number literal such as `200`.
- Browser tests live in the `test.ui` package and run only in `./gradlew uiTest`; `./gradlew test` excludes that
  package. Page objects live in the package `page`.
- UI base URI: Owner key `MARKETDESK_UI_BASE_URI`, read through `config.MarketDeskUiConfig.BASE_URI`, default in
  `src/main/resources/marketdesk-ui.properties` (`http://127.0.0.1:3000`); `gradle/tests.gradle` forwards the system
  property too.
- With `BROWSER_REMOTE_URL` set (for example `http://127.0.0.1:4444/wd/hub`) the browser runs in the Selenium Grid,
  and `MARKETDESK_UI_BASE_URI` must be an address the Grid container reaches. With `BROWSER_REMOTE_URL` unset,
  `uiTest` uses a local browser against the default address.
- In the script's stack the Grid container shares the application's network namespace
  (`docker/selenium-grid/docker-compose.yml`, `network_mode: "service:app"`), so the script uses
  `MARKETDESK_UI_BASE_URI=http://localhost:3000`. The application sends `upgrade-insecure-requests` and HSTS, which
  browsers apply to every host except localhost, so a plain `http://app:3000` fails with `ERR_SSL_PROTOCOL_ERROR`.
