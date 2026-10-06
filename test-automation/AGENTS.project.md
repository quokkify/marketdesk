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
  the way CI does. The stack needs a base64 32-byte `MARKETPLACE_CREDENTIALS_KEY`; without it the server answers only
  `/health` and `/ready`, and every `/api/*` call returns 404.
- Tests run in parallel through the q4j `SuiteListener` (see [docs/agents/test-execution.md](docs/agents/test-execution.md));
  keep steps and services free of per-test state, and mark a test that needs exclusive use of the stack with
  `@SingleThread`.
- `verifyArchitecture` runs `HttpStatusConstantRule`: tests in `test.api` pass statuses as `HttpStatus` constants, and
  the build fails on a number literal such as `200`.
