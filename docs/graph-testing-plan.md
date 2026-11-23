# Graph testing plan

Status: written 2026-11-22. The stage "now" pilot for the price research graph is implemented in the same pull
request as this document; see "What the pilot settled". Everything else is still a plan.

The goal is deterministic tests of the LangGraph graphs that run without a paid model, locally on an Apple Silicon Mac
and on the free CI runners, introduced in stages that do not block feature work.

Statements marked **(assumption)** were not verified against documentation or code.

## Read this first: where the bugs came from

Product defects found after merge between 2026-11-13 and 2026-11-22, classified from the pull request descriptions.
The sample is small (about ten days of active work) and the three feature rows are my reading of why the feature was
built.

| Cause | Cases | Would the stage "now" pilot have caught it |
| --- | --- | --- |
| The real OLX behaves differently from what the code assumed | #475 (advert has `category_id`, tests used an invented shape), #480 (`disabled` means waiting for verification), #501 (`PUT` replaces the whole advert and dropped delivery) | No |
| The model answered badly on production | #488 (three "keep 399, low confidence" answers), #502 (a substitute of another class), #504 (different prices for one item depending on the button) | No |
| Wiring that only a real stack shows | #492 (long Hermes reasoning overflowed `VARCHAR(255)`), #449 (clock read before the taxonomy check) | No. #492 needs the main profile behind the mock and a realistically long answer (stage 3) |
| Missing domain rule | #481 (product stayed draft when its advert went live) | No |
| Interface wording | #486 | No |
| Security audit findings, not regressions | #462, #463, #467, #468 | No |

Consequence for priorities: the mock-server layer for Hermes is sound but it is not where the defects were. Two things
would have caught more and should come before it:

1. **Recorded real OLX answers behind the mock server.** The same MockServer, standing in for the OLX Partner API,
   fed with answers captured from the real API. This targets the first row; see "OLX contract layer" below.
2. **A small set of reference products run against the real Hermes on the VPS** before a release that changes
   prompts, with the expected verdict written down per product. This targets the second row and is the only kind of
   check that can.

The sections after "OLX contract layer" describe the Hermes mock layer as originally scoped.

## OLX contract layer

Read on `origin/main` at `3f571b7`.

### What it can and cannot catch

- **Catches wrong assumptions about shapes**, the #475 kind: the adapter is run against an answer OLX really gave,
  not against a shape the test author invented.
- **Guards known semantics against regression**, the #480 and #501 kind, once the fact is known and written into a
  recording or a request check. It would not have discovered either: a static answer cannot show that `PUT` replaces
  the whole advert or what `disabled` means.
- **Does not replace the hand check on production** for a first use of an endpoint. The OpenAPI specification is not
  enough either: production wraps `GET /threads` in `{ "data": [] }` where the specification documents a bare array
  (noted during #489).

### Can the adapter run in real mode against a mock

Yes, by configuration only; no code change was found necessary.

- Every OLX address comes from the environment: `OLX_API_BASE_URL`, `OLX_AUTH_URL`, `OLX_TOKEN_URL`
  (`src/backend/config/env.ts`, lines 301–303).
- The real transport, `FetchMarketplaceHttpClient.ts`, has no host allow-list. Its one guard refuses advert creation
  unless `OLX_LIVE_PUBLISH_ENABLED=true`, and it recognises creation by a path ending in `/api/partner/adverts`. The
  mock therefore keeps the `/api/partner` prefix, and the mock stack sets the flag to `true`: the requests go
  nowhere real.
- The boot gate needs `PUBLIC_BASE_URL` to be set and public. It checks the host name only (`env.ts`, lines
  122–131), so a reserved name such as `https://marketdesk.example` passes.
- Real mode also needs the publish details (`OLX_CITY_ID`, `OLX_CONTACT_NAME`, category ids;
  `requirePublishDetails` in `container.ts`).
- Connecting an account: the callback `GET /api/marketplaces/olx/oauth/callback` is public
  (`routes/index.ts`, line 116) and exchanges the code at `OLX_TOKEN_URL`. A test starts the connection, takes the
  `state`, and calls the callback itself; the mock answers the token request. **(assumption: the start call returns
  the state to the client; not traced.)**

### The mode is global, so this needs its own stack

`OLX_ADAPTER_MODE` is read once and decides the transport, the sandbox labels and the OAuth wiring for the whole
process (`container.ts`). Every existing test relies on the sandbox, and two app instances cannot share one Redis:
each would take the other's queue jobs. So the contract tests run on a second Compose project with its own Postgres
and Redis, started after the main suite.

| File | Change |
| --- | --- |
| `docker/mock-server/docker-compose.yml` | Shared with the Hermes layer |
| `docker/mock-server/expectations/olx/**` (new) | Captured answers, one folder per endpoint |
| `scripts/ci-java-olx-contract-tests.sh` (new) | Starts the second project in real mode against the mock, runs `./gradlew olxContractTest`, tears down |
| `test-automation/gradle/tests.gradle` | New task `olxContractTest` for the package `test.olx`, excluded from `test`, `apiTest`, `uiTest` |
| `test-automation/.../step/OlxMockSteps.java`, `service/OlxMockService.java` (new) | Register answers, verify received requests |
| `test-automation/.../step/MarketplaceSteps.java` | New step: connect an OLX account through the OAuth callback |
| `.copier-answers.java.yml`, `.ci/modules/java.yml` | The test command runs both scripts |

Client id, secret and token values in the script are built at run time, not written as literals: Gitleaks scans the
whole branch history.

### Endpoints to cover

From `OLXAdapter.ts` and `OlxTaxonomyResolver.ts`:

| Endpoint | Used by | Capture |
| --- | --- | --- |
| `GET /adverts`, `GET /adverts/{id}` | import, sync, update | Read-only, from production |
| `GET /adverts/{id}/statistics` | sync | Read-only, from production |
| `GET /categories`, `GET /categories/{id}` | taxonomy | Read-only, from production |
| `GET /threads`, `GET /threads/{id}/messages` | conversations | Read-only; the account had no threads on 2026-11-21 |
| `POST /adverts`, `PUT /adverts/{id}`, `DELETE /adverts/{id}` | publish, update, delist | Cannot be recorded without acting on a real advert |
| `POST /adverts/{id}/commands` | reactivation | Same; answers `204` per the adapter comment |
| `POST /threads/{id}/messages` | reply send | Same |
| token endpoint | connect, refresh | Hand-written; never captured |

For the write calls the value is in checking **what the app sends**, with `PUT /mockserver/verify`
([verification](https://www.mock-server.com/mock_server/verification.html)). Example, the #501 guard: after a price
change the received `PUT /adverts/{id}` body must carry the `ad_delivery.delivery_package_ids` of the recorded `GET`.

MockServer can also build expectations from an OpenAPI v3 file and match requests by operation
([using OpenAPI](https://www.mock-server.com/mock_server/using_openapi.html)), and OLX publishes one
(`https://developer.olx.pl/swagger/v2/partner_api.yaml`, `openapi: 3.0.2`). Whether a request body is validated
against the schema, and whether the OLX file has operation ids, was not confirmed. Treat it as a later addition, not
as the source of answers.

### Capturing on production

By the owner, read-only:

- a probe script run inside the production app container, as was done for #489: it reads the stored token and sends
  `GET` requests only, writing each answer to a file;
- it never refreshes the token; if the token has expired, press Sync in the app first;
- the app's own configuration is not changed, and no mock server runs next to production for OLX.

Before committing, every capture is scrubbed: contact name and phone, user and account ids, buyer names and message
text, advert ids and URLs are replaced with synthetic values of the same shape. The repository is public.

### Stages

Each is one pull request.

1. **Pilot, 1–2 days after the first capture: import preview.** Second stack, mock, OAuth connect step, and one test:
   a captured `GET /adverts` answer plus the category answers; the preview must show each advert with its category
   and status. This is the #475 case, it is read-only, and it needs no write semantics.
2. **Status table.** One captured advert per OLX status that was seen; sync must map each as
   `docs/olx-status-reconciliation.md` says. Guards #480.
3. **Write paths with request checks.** Price change and revival keep delivery (#501); reactivation sends the
   `activate` command; publish sends what `POST /adverts` requires.
4. **Threads**, once the account has real ones to capture.

Pilot skeleton; `OlxMockSteps`, `connectOlxThroughOAuth` and the verification methods are new:

```java
package dev.quokkify.marketdesk.test.olx;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

public class OlxImportContractTest extends BaseTest {

  @Test
  public void capturedAdvertsAreOfferedWithCategoryAndStatus() {
    AccountPojo account = authSteps.registerNewAccount();
    // Each account gets its own access token from the mock, so its answers match only its own requests.
    String olxSeller = olxMockSteps.issueToken(account);
    olxMockSteps.answerAdvertList(olxSeller, "olx/adverts/list-three-adverts.json");
    olxMockSteps.answerCategories(olxSeller, "olx/categories");
    String marketplaceId = marketplaceSteps.connectOlxThroughOAuth(account);

    marketplaceSteps.verify().offersEveryAdvertWithCategoryAndStatus(
        marketplaceSteps.previewImport(account, marketplaceId, MarketplaceImportRequestPojo.empty()),
        "olx/adverts/list-three-adverts.json");
  }
}
```

Parallel tests are told apart by the `Authorization` header: the mock gives each test account its own token, and
every expectation matches on it. Header matching is part of the request matcher
([creating expectations](https://www.mock-server.com/mock_server/creating_expectations.html)); how the token answer
is tied to one test's callback was not worked out **(assumption: by the `code` value the test passes to the
callback)**.

### Open questions

- CI time: a second stack adds a build-free start of Postgres, Redis, the app and the mock. Not measured.
- A capture switch inside the app (write real answers to a directory when a flag is set) would also record the write
  calls as they happen. It touches production code and thread text; not proposed here, the owner decides.

## Summary

The repository facts below were read on the branch `chore/remove-playwright`. While this plan was written, `main`
gained #504: `SaleVerdictGraph` with three check subgraphs (`src/backend/application/services/verdict/`) and its own
Jest tests, and a smaller `ProductAssistanceGraph`. Those files were read only in outline; the graph table and the
test counts below do not include them.

### What the repository holds

- **The graphs are TypeScript, not Java.** `package.json` declares `@langchain/langgraph ^1.4.18` and
  `@langchain/core ^1.1.48`; the installed versions are 1.7.5 and 1.5.0 (`node_modules/@langchain/*/package.json`).
  Java exists only in `test-automation/` (q4j 0.16.0, TestNG 7.12.0, `test-automation/gradle/libs.versions.toml`).
- **Four graphs**, all in `src/backend/application/services/`:

  | Graph | Nodes | Conditional edges | Model calls |
  | --- | --- | --- | --- |
  | `PriceResearchGraph.ts` | `identify`, four tier nodes in parallel, `filter`, `save` | after `identify` (fan out or end), after `filter` (save or end) | up to 2 for `identify`, 1 per tier |
  | `ConversationReplyGraph.ts` | `screen`, `classify`, `draft`, `validate` | after `screen` (end or classify) | `classify`, `draft` |
  | `ProductAssistanceGraph.ts` | `route`, `draft`, `publication`, `improve`, `revive` | after `route`, by input kind | SEO and price suggestion |
  | `response/ListingResponseGraph.ts` | `load`, `known`, `queries`, `probe`, `locate`, `compare`, `rank`, `save` | after `known` (queries or rank), after `queries` (probe or rank) | 1, the buyer queries (main profile) |

  `ListingResponseGraph` was added on the branch `feat/listing-response-graph`. Its `probe` node is code: it loads
  the public OLX search pages itself, so no research-profile call is involved.

- **No checkpointer, interrupt, streaming or tool calling** inside the graphs; subgraphs appear only in the sale
  verdict graph on `main`. State is a small
  `Annotation.Root`; buyer and model text stay in a per-run context outside state.
- **The model is one HTTP call.** `src/backend/infrastructure/external/HermesCompletionClient.ts` sends
  `POST {apiUrl}/chat/completions` with `stream: false` and reads only `choices[0].message.content` and `usage`.
  Hermes decides which model and tools to use; the app has no direct model SDK.
- **Everything is injected.** Each graph takes repositories, the AI port, `now` and (for research) a limiter through
  its constructor; `src/backend/config/di/container.ts` wires them. No place needs a refactor to substitute the model.
- **External dependencies of the graphs:** Hermes (two profiles: main and research), Postgres through repositories,
  the clock through `now`. No randomness. The research graph also asks `GET /models` and `GET /toolsets` before every
  call (`HermesHealthProbe.ts`) and requires exactly the `web` toolset (`anchorLadderPrompt.ts`,
  `isResearchToolsetSafe`).
- **Tests that exist:**
  - Jest, with scripted fakes at the port level: `__tests__/PriceResearchGraph.test.ts` (19 cases),
    `ConversationReplyGraph.test.ts` (20), `ProductAssistanceGraph.test.ts` (8). They run in CI through
    `scripts/ci-test.sh` (`.ci/modules/node.yml`).
  - `ListingResponseGraph` on the branch: Jest tests with fakes for the pure stage rules and for the graph
    (`response/__tests__/ListingResponseGraph.test.ts`), and live q4j tests on the branch stand
    (`test-automation/.../test/api/ListingResponseTest.java`, `test/ui/ListingResponseUiTest.java`). The stand's
    MockServer stands in for the main Hermes profile (the buyer-queries call) and for the OLX search pages, which the
    app reads from `OLX_SEARCH_BASE_URL`. The real-OLX path is checked by hand.
  - An offline experiment runner for the improvement route (`docs/sales-agent-experiments.md`).
  - q4j live tests against the Compose stack (`scripts/ci-java-api-tests.sh`). In that stack Hermes is unreachable
    and the research profile is not configured, so no graph runs through its HTTP boundary.
    `PriceResearchRefreshTest.java` says so: "the real web research is checked by hand on production".

### What blocks testing today

1. **The stack has nothing standing in for Hermes.** The research graph cannot run on the stand at all; the other two
   run only against the offline heuristics.
2. **Hermes runs only on the VPS.** Real answers can be captured only there, and the app must never be the thing
   that is repointed for it.
3. **The compiled graphs are private.** `PriceResearchGraph.build` and `ConversationReplyGraph.compile` are private
   and compile per run; `ProductAssistanceGraph.graph` is a private field. A topology snapshot needs an accessor.

## Options

Speed and effort are my estimates; nothing here was measured.

| # | Option | What it checks | Cost | Speed | Deterministic | Mac | Free runner | Effort | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Unit tests of nodes and routing | Pure rules: filters, class match, price sanity, screening, draft validation | Free | ms | Yes | Yes | Yes | Exists for domain services; nodes are closures, tested through the graph | `src/backend/domain/services/`, [LangGraph test page](https://docs.langchain.com/oss/javascript/langgraph/test) |
| 2 | Whole graph with a scripted fake | Node path, outcomes, retries, timeouts, final state | Free | ms | Yes | Yes | Yes | Exists (47 cases); extend per feature | the three `*Graph.test.ts` files |
| 3 | Checkpoints, interrupt, `updateState` on `MemorySaver` | Durable runs | Free | ms | Yes | Yes | Yes | Not applicable: no graph has a checkpointer | [LangGraph test page](https://docs.langchain.com/oss/javascript/langgraph/test) |
| 4 | Recorded HTTP answers behind a mock server | The HTTP client, the probe, queue, persistence and API around the graph, end to end | Free | seconds per run | Yes, once answers are curated | Yes | Yes | Medium | [MockServer](https://www.mock-server.com/mock_server/creating_expectations.html), `path-of-exile-starter/tools/docker/docker-compose.yml` |
| 5 | Local small model (Ollama) | Whether a real model follows the prompts | Free | slow **(assumption)** | No | Yes **(assumption)** | Unknown | High, low value | not researched, see below |
| 6 | Free cloud tier, nightly | Same as 5 | Free tier | — | No | — | — | — | not researched, see below |
| 7 | Topology snapshot (Mermaid) | Accidental changes of nodes and edges | Free | ms | Yes | Yes | Yes | Small, needs an accessor | `node_modules/@langchain/core/dist/runnables/graph.d.ts` (`drawMermaid`) |

Notes:

- **Option 4, why MockServer and not WireMock.** Both fit. MockServer is already used in `path-of-exile-starter`
  with a pinned image and the `ci-kit` compose action, and its `times` plus `priority` fields express "first answer
  bad, second good" without server-wide scenario state
  ([creating expectations](https://www.mock-server.com/mock_server/creating_expectations.html): matching is ordered
  "by priority (highest first) then creation (earliest first)"). WireMock needs scenarios for that
  ([stateful behaviour](https://wiremock.org/docs/stateful-behaviour/)).
- **Options 5 and 6 are outside this plan.** The graphs need no tool calling, and the research graph refuses any
  endpoint that does not answer `/toolsets` with exactly `web`, which a plain model server does not offer
  **(assumption for Ollama)**. Model sizes, CPU timings and free-tier limits were not researched. They would test
  model quality, which is a different question from regressions in the graphs.

### CI runner limits

- Standard GitHub-hosted Linux runner for a public repository: 4 vCPU, 16 GB RAM, 14 GB SSD, free and unlimited
  ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). The
  repository is public (`gh api repos/quokkify/marketdesk`), and the jobs run on `ubuntu-latest`
  (`ci-kit/.github/workflows/validate.yml`).
- Cache: 10 GB per repository, entries unused for 7 days are removed
  ([dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).
- Docker and Compose: the documentation page does not list them, but `scripts/ci-java-api-tests.sh` already runs
  `docker compose up` with Postgres, Redis, the app and a Selenium Grid in CI.
- A MockServer container is a JVM process; its memory use next to the existing stack was not measured
  **(assumption: it fits in 16 GB)**.

## Recommended pyramid

1. **Base: Jest graph tests with scripted fakes (exists).** Every branch of every graph is cheapest to pin here:
   milliseconds, no Docker, runs on each commit. New graph behaviour gets its case here first.
2. **Middle: q4j API tests on the Compose stack with MockServer in place of Hermes (new).** A few scenarios per
   graph, not every branch. They cover what the fakes cannot: the HTTP client, the toolset guard, the queue, the
   run record, persistence and the API answer.
3. **Top: the real Hermes on the VPS, by hand.** Unchanged. It stays the only check of model quality.

Topology snapshots sit beside the base as a cheap guard. Nothing in the pyramid costs money.

## What the pilot settled

The pilot was built after the rest of this document was written. Where the two differ, this section is right.

- **One body matcher is enough.** A single `REGEX` body matcher holding the node marker and the product's unique
  token tells every call apart, so the tests run in parallel on one MockServer and need no `@SingleThread`
  (`HermesMockSteps`). `times.remainingTimes` gives "answer once, then differently", and `PUT /mockserver/verify`
  counts calls. A request with no expectation is answered `502` by this image.
- **The image runs on Apple Silicon.** `mockserver/mockserver:7.6.0` at the pinned digest is published for
  `linux/arm64`.
- **The answers are recorded, not hand-written.** MockServer ran on the Mac in forwarding mode
  (`-proxyRemoteHost`, `-proxyRemotePort`) towards an SSH tunnel to Hermes on the VPS; nothing ran on the VPS and
  the app there was not touched. The real graph was driven by a script with in-memory repositories. Three things
  to know before recording again:
  - MockServer gives up on the upstream after 20 seconds unless `MOCKSERVER_MAX_SOCKET_TIMEOUT` is raised; a
    research call takes 20–50 seconds.
  - The recording stores the `Authorization` header. Strip all headers before the file leaves the machine.
  - One of four parallel calls failed with `502` after exactly 90 seconds; the cause was not found. Single calls
    recorded reliably.
- **What the recording showed** and the fixtures keep: an OLX link on `olx.pl` without `www` and with a
  `?search_reason=` tail, one value spelled `1280×720` and `1280 x 720`, `unit: "pixels"`, and an empty
  `{"anchors":[]}` as a normal answer. One call used 26–63 thousand prompt tokens.
- **Configuring the research profile changed other tests.** Every price check on a PLN listing now starts a
  research run. Products without registered answers get `502`, so those runs end `hermes_unavailable` after two
  `identify` attempts. Expectations in `SaleVerdictTest`, `AiUsageTest`, `AiUsageUiTest`, `PriceResearchUiTest`
  and comments in three more classes were updated. The stand no longer covers "research not configured"; Jest
  does.
- **Open, for the owner:** with the recorded prices of new substitutes (229 and 229.99 PLN) the price sanity check
  drops both recorded last-new prices (769 and 799 PLN). The fixtures use 279 and 299.99 so that the "all tiers
  answered" run ends `ok`. Whether the check should drop them on the real prices was not investigated.

## Stage "now" (1–2 days)

One pull request, research profile only. The main profile stays unreachable, so every existing test keeps running on
the offline heuristics and nothing else changes behaviour.

Pilot graph: `PriceResearchGraph`. It has the most nodes, the only parallel fan-out and the only retry, and today it
has no coverage on the stand.

### Files

| File | Change |
| --- | --- |
| `docker/mock-server/docker-compose.yml` (new) | `mock-server` service, image `mockserver/mockserver` pinned by digest as in `path-of-exile-starter`; expectations for `GET /models` and `GET /toolsets` loaded at start through `MOCKSERVER_INITIALIZATION_JSON_PATH` ([initializing expectations](https://www.mock-server.com/mock_server/initializing_expectations.html)) |
| `docker/mock-server/expectations/research/*.json` (new) | The two probe answers; `/toolsets` returns one enabled entry named `web` |
| `scripts/ci-java-api-tests.sh` | Add the compose file to `COMPOSE_FILE`; export `HERMES_RESEARCH_API_URL` pointing at the service and a `HERMES_RESEARCH_API_KEY` that does not start with `your_` |
| `test-automation/.../config/HermesMockConfig.java` (new) | Owner key for the MockServer address, next to `MarketDeskApiConfig` |
| `test-automation/.../service/HermesMockService.java` (new) | REST Assured calls to `PUT /mockserver/expectation`, `/clear`, `/verify` |
| `test-automation/.../step/HermesMockSteps.java` (new) | Steps that register answers per research node for one product |
| `test-automation/src/main/resources/hermes/research/*.json` (new) | Answer bodies: one identification, one answer per tier |
| `test-automation/.../test/api/PriceResearchRunTest.java` (new) | The pilot tests |
| `test-automation/.../test/api/PriceResearchRefreshTest.java` | Remove the three "not configured" tests: the stack now has a research profile. The rule stays covered in `PriceResearchGraph.test.ts` |

### How one test addresses its own answers

All research calls are `POST` to one path and differ only in the body. Two markers in the prompt tell them apart:

- the node: every prompt starts with `Node: <name>.` (`priceResearchPrompts.ts`, lines 113 and 219);
- the product: its name goes into the prompt (`researchItemFromProduct`), so each test creates a product with a
  unique name.

MockServer matches a body substring with `{"type": "STRING", "string": "...", "subString": true}`
([creating expectations](https://www.mock-server.com/mock_server/creating_expectations.html)). Whether two body
conditions can be combined in one expectation is **not confirmed**; it is the first thing to try. Fallback: mark the
research tests `@SingleThread` (already supported, `test-automation/AGENTS.project.md`) and clear expectations between
them with `PUT /mockserver/clear`
([clearing](https://www.mock-server.com/mock_server/clearing_and_resetting.html)).

### Test skeleton

`HermesMockSteps`, its methods and the verification methods are new. The run is asynchronous: the refresh answers
`202` and the graph runs in a queue job (`ProductController.refreshPriceResearch`), so the test waits for the run to
finish. The field names of the run view must be read from the API before writing the verification.

```java
package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

public class PriceResearchRunTest extends BaseTest {

  @Test
  public void allTiersAnsweredSavesTheLadder() {
    AccountPojo account = authSteps.registerNewAccount();
    // New: a sample whose name is unique, so the answers below match only this product's prompts.
    ProductRequestPojo product = ProductRequestPojo.sampleWithUniqueName();
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);

    hermesMockSteps.answerIdentify(product.name(), "hermes/research/identify-projector.json");
    hermesMockSteps.answerTier(product.name(), "sameModelUsed", "hermes/research/same-model-used.json");
    hermesMockSteps.answerTier(product.name(), "lastNewPrice", "hermes/research/last-new-price.json");
    hermesMockSteps.answerTier(product.name(), "substitutesNew", "hermes/research/substitutes-new.json");
    hermesMockSteps.answerTier(product.name(), "substitutesUsed", "hermes/research/substitutes-used.json");

    priceResearchSteps.verify().isRefreshAccepted(
        priceResearchSteps.refreshPriceResearch(account, created.productId()));

    priceResearchSteps.verify().runEndsWith(account, created.productId(), "ok");
    priceResearchSteps.verify().hasAnchorsOfAllTiers(
        priceResearchSteps.getPriceResearch(account, created.productId()));
    hermesMockSteps.verify().wasCalledOnce(product.name(), "identify");
  }

  @Test
  public void identifyRetriesOnceAfterAnUnusableAnswer() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductRequestPojo product = ProductRequestPojo.sampleWithUniqueName();
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);

    // times.remainingTimes = 1: the unusable answer is served once, then the usable one answers.
    hermesMockSteps.answerIdentifyOnce(product.name(), "hermes/research/identify-prose.json");
    hermesMockSteps.answerIdentify(product.name(), "hermes/research/identify-projector.json");
    hermesMockSteps.answerAllTiers(product.name());

    priceResearchSteps.refreshPriceResearch(account, created.productId());

    priceResearchSteps.verify().runEndsWith(account, created.productId(), "ok");
    hermesMockSteps.verify().wasCalledTimes(product.name(), "identify", 2);
  }
}
```

Open points of the skeleton: `createOlxProductListing(account, ProductRequestPojo)` exists but its visibility was not
checked; the listing must be in PLN, otherwise the run is refused with `SEARCH_NEEDS_PLN`.

### Where the first answers come from

Write them by hand from the shapes the Jest test already uses (`IDENT`, `TIER_ANSWERS` in
`PriceResearchGraph.test.ts`) and from the JSON contracts in the prompts. The envelope is small: `choices[0].message.content`
holding the JSON as a string, plus `usage`. This stage does not depend on the VPS.

## Stage "later"

In this order; each is its own pull request.

1. **Make recording repeatable.** The pilot's recording was done by hand (see "What the pilot settled"). Turn it
   into scripts plus a project skill: start the recording MockServer, record one node at a time through the
   tunnel, strip headers, then curate:
   - before committing: replace third-party listing URLs and titles with synthetic ones, drop headers, loosen the
     recorded body matcher to the two substrings. The repository is public and Gitleaks scans full branch history.

   Value: realistic content, such as prose around the JSON or markdown fences, becomes a regression case.
2. **Topology snapshots.** Add a way to build each graph without a run context (a static builder or a test-only
   accessor), then a Jest snapshot of `getGraph().drawMermaid()` per graph. Small refactor in the three graph files,
   so schedule it when no feature branch is rewriting them.
3. **Conversation reply graph on the stand.** Needs the main profile behind MockServer. That switches the whole
   stack from the offline heuristics to "Hermes", because provider mode `auto` follows the probe
   (`AIProviderSelector.activeProvider`) and the probe caches for 60 seconds. Every existing test that reaches an AI
   call then needs an answer, so this stage starts with default low-priority expectations for each operation and a
   full run of the existing suite.
4. **Product assistance graph on the stand.** Same prerequisite as 3.
5. **Failure scenarios over HTTP:** `500` from Hermes, a non-JSON body, a delayed answer against the run budget.

### What runs when

| When | What |
| --- | --- |
| Every commit and pull request | Jest graph tests, topology snapshots, the q4j stack tests with MockServer |
| Nightly | Nothing new is required. A nightly run against the real Hermes would need the runner to reach the VPS and is not planned |
| By hand, before a release that changes prompts | The real research on the VPS, as today |

## Risks and open questions

Risks:

- **Loose matching hides prompt changes.** A stub matched by two substrings answers whatever the rest of the prompt
  says. Prompt wording is pinned by the Jest tests of the prompt builders, not by the stand.
- **Curated answers drift from the real Hermes.** Only a new capture on the VPS shows it.
- **Stage 3 changes the behaviour of the whole stand.** It can turn many unrelated tests red at once; it must not be
  merged together with anything else.
- **The image tag.** `mockserver/mockserver:7.6.0` is pinned by digest; Docker Hub currently shows 9.4.0 tags. The
  update is Renovate's to propose.

Decided by the owner on 2026-11-22:

- The three "not configured" tests in `PriceResearchRefreshTest` are removed in the stage "now" pull request.
- Answers are recorded on the owner's Mac through an SSH tunnel to the VPS; nothing runs on the VPS.

Open question for the owner:

- Should stage 3 happen at all, given that it moves the stand off the offline heuristics that today's tests rely on?
