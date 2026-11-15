# Publish run recorder: local runs an agent can read, replay and turn into tests

**Status:** draft, awaiting owner approval · **Baseline:** `main` at `220af8711f`

When the owner runs MarketDesk locally and publishes a product by hand, every attempt leaves a
sanitized record on disk: what the request did, which graph node refused it, what the worker
sent to the marketplace and what came back. A coding agent reads that record with one command,
live or afterwards, and turns a failed run into a failing Jest case with one more command. The
recording hooks sit in marketplace-neutral places, so a second marketplace adapter is observable
without extra code. No new dependencies and no database migration.

## 1. Intent

The owner's words: add "some kind of tracing or profiling" that helps the agent "very much" while
the app runs locally. The owner starts the app and tries to publish a product; the agent follows
logs and traces, and when it sees a breakage it fixes it, writes a test for the error, prepares
the functionality for other marketplaces, and possibly adds a guard for LangChain. The owner
expects a large saving on fix cycles.

The owner chose to work both ways on one record: live while they click, and afterwards from a
durable record ("look at the last publication").

Why this is needed today:

- `pino` is used only in `main.ts`, `config/database.ts`, `config/redis.ts`, the migration and
  seed scripts and the HTTP error middleware. Use cases, the publish worker, the OLX adapter and
  the Hermes client log nothing.
- `createErrorHandler` in `presentation/http/middleware/ErrorHandlingMiddleware.ts` logs only
  non-domain errors and 5xx. An expected `DomainError` answered with 4xx (category guard, quota,
  account not connected) leaves no trace anywhere.
- There is no request or correlation id. `operationId` exists, but only from the `category` node
  of the preflight graph onward, so a refusal in `load`, `eligibility` or `account` has no id.

## 2. Goals, non-goals, anti-goals

**Goals**

1. One id per attempt, carried from the HTTP request through the queue into the worker and every
   retry.
2. A sanitized, append-only record of each run on disk, readable while the run is in progress.
3. One command line tool for the agent: list runs, show one run, follow runs live, export a
   failed run as a replay fixture. Every read command has machine-readable output.
4. A captured failure becomes a red Jest case without hand-written test code.
5. A new marketplace adapter that extends `BaseMarketplaceAdapter` is recorded and replayable
   with no recorder code of its own, and a contract test proves it for every registered key.
6. Deterministic guards on both LangGraph graphs and on AI provider output.
7. Leaking a secret into a record or a tracked fixture is structurally hard, not a convention.

**Non-goals**

- Fixing the defects the recorder exposes. Appendix A lists the first one. Each fix is its own
  task with its own test.
- Browser-side error capture. A failure that never reaches the backend is out of this design;
  the response header `X-Run-Id` is the bridge from the network tab to a run.
- OpenTelemetry, a trace UI, metrics, or a performance profiler.
- Recording in production.
- A second marketplace adapter. This design only makes the path ready for one.

**Anti-goals**

- A token, OAuth code, `.env` value or a seller's personal data in a tracked file.
- A recorder fault that fails or delays a publish.
- Any change in behaviour when the recorder is off.
- A new SQL migration (all migrations re-run on every start).

## 3. Constraints

- The repository is public. Every `.env` value counts as a secret.
- Backend is ESM, bundled by esbuild with `--packages=external`; dev runs under `tsx watch`.
- Local run is either Docker Compose (the app writes inside a container as UID 1001) or
  `npm run dev` on the host. The agent's tool always runs on the host.
- `NODE_ENV` defaults to `development` in `docker-compose.yml`.
- `.local/`, `tmp/` and `logs/` are already in `.gitignore` and `.dockerignore`.
- Jest has no DOM; `tsconfig` excludes `*.test.*` from `type-check`.
- CodeQL flags routes without a visible rate limiter, which is one reason no new HTTP route is
  added.

## 4. Approaches

Four designs were written independently and scored by three reviewers (agent debuggability,
maintenance cost, adversarial). Totals out of 30:

| Approach | Score | Trade-off |
|---|---|---|
| Record and replay (run cassettes) | 23.5 | Best failure-to-test path and the only correct recorder placement; more to build |
| Interface-first (CLI and failure line first) | 22.5 | Fewest steps for the agent; weaker replay and a risky state snapshot |
| In-house journal only | 18 | Smallest; shows which call failed but not the input, so tests stay manual |
| OpenTelemetry | 16.5 | Standard model; three dependencies while exporter, redaction and CLI stay hand-written |

**Chosen by the owner: record and replay**, with these parts taken from the others:

- From interface-first: the id is stamped into the job by the queue wrapper, not by the use case;
  one table-driven replay test instead of a generated test file per bug; a single greppable
  failure line; the graph shape drift test and the import boundary for `@langchain/*`.
- From the journal: run id added to existing `pino` lines; repository errors recorded with
  SQLSTATE, constraint and table and never with arguments.
- From OpenTelemetry: host and path stored as separate fields; OAuth exchanges recorded as
  status only.

The owner rejected the journal-only variant because content-dependent failures (the marketplace
refuses one field) would still be reproduced by hand.

## 5. Design

### 5.1 Run identity

A run is one inbound API request plus everything it causes, including the queued job and all its
Bull attempts.

- An Express middleware opens an `AsyncLocalStorage` context with a new `runId` for every `/api`
  request and sets the `X-Run-Id` response header.
- The queue hop: `BullManagedQueue` in `config/di/container.ts` adds one reserved key, `__run`
  (`{ runId }`), to the job data object in `enqueue` and `enqueueAll` when the recorder is on and
  a run is active. `registerHandler` removes the key before calling the handler and re-opens the
  context, adding the Bull attempt number. It is a key on the payload, not an envelope, so a job
  queued before the change has the same shape as one queued with the recorder off. The job types
  (`PublishListingJob`, `SyncMarketplaceJob`) and the use cases are not changed.
- `scheduleRepeat` adds nothing. A job that arrives without `__run` (legacy, repeat, or recorder
  off at enqueue time) gets a fresh run of kind `job`.
- `operationId`, `listingId` and the marketplace key are recorded as links when they become
  known, so a run is found by any of them.
- A `pino` mixin adds `runId` to existing log lines.

### 5.2 What is recorded

One event type per seam, all through one recorder port (`IRunRecorder`, application layer, no-op
by default):

| Seam | Where | Content |
|---|---|---|
| `http` | the run middleware and `createErrorHandler` | method, route pattern, status, duration; every error including `DomainError` 4xx, with code and decision details |
| `graph.node` | a shared node wrapper used by both graphs | graph version, node, start / ok / error |
| `queue` | `BullManagedQueue` | enqueued, attempt N started / failed / completed, job id, the job payload |
| `adapter.op` | `BaseMarketplaceAdapter.execute` | operation, normalized `MarketplaceError` code, retryable |
| `adapter.http` | a recording client wrapped around `http` in the `BaseMarketplaceAdapter` constructor | method, host, path, request body, status, response body |
| `ai.call` | a decorator on `IAIProvider` in the container | method, provider mode, duration, validation outcome; no prompt text |
| `attempt` | the publish worker | `publish_attempts` status transitions per attempt |
| `error` | worker and middleware | class, code, SQLSTATE / constraint / table, top application stack frame as `file:line` |

The recording client must sit in the base adapter constructor: in sandbox mode
`MarketplaceAdapterFactory` passes no client and `OLXAdapter` builds its own
`StubMarketplaceHttpClient`, so a wrapper applied in the container would record nothing for
sandbox runs. The wrapper reads the active run from the ambient context and passes straight
through when there is none.

OAuth clients are recorded as method, host, path and status only.

Start events are written before the call they describe, so a hung or killed run is visible.

### 5.3 Storage

- Directory: `.local/runs/` in the repository root, resolved from `RUN_RECORDER_DIR`.
- `.local/runs/<runId>/events.jsonl`: append-only, one event per line, written synchronously.
- `.local/runs/index.log`: one line per state change that matters to a watcher:

  | Line | Written when |
  |---|---|
  | `RUN-BLOCKED <runId> ...` | the request ended with an expected `DomainError` 4xx (a guard refused it) and queued no job |
  | `RUN-RETRY <runId> ...` | a Bull attempt failed and another will follow |
  | `RUN-FAIL <runId> ...` | once per run: the request ended with an unexpected error or 5xx, or the last Bull attempt failed (`attemptsMade + 1 >= opts.attempts`; the count is 3 in `buildBullAddOptions`) |
  | `RUN-OK <runId> ...` | the request succeeded with no job, or the job completed |

- Run lifecycle: a request that queued a job leaves the run open when the response is sent; the
  job's terminal line closes it. A run's outcome is derived from its events at read time. A run
  with a start event and no terminal line (stalled or removed job, killed process) is shown as
  `open`, and as `stale` once it is older than ten minutes. No watcher on Bull's stalled events
  is added.
- A run directory is created lazily: for any non-GET request, and for any request that ends in
  an error. Successful reads leave nothing.
- Rotation at startup: keep the newest 200 runs.
- **On by default in development, impossible in production.** The recorder is enabled when
  `NODE_ENV` is `development` and `RUN_RECORDER` is not `off`. With `NODE_ENV=production` or
  `NODE_ENV=test` (Jest) the container always wires the no-op recorder, whatever the other
  variables say. The Playwright visual run serves a built frontend against a mocked API and
  starts no backend, so it needs no switch.
- Startup logs one line saying whether the recorder is on and where it writes.
- Compose: the `app` service sets `RUN_RECORDER_DIR=/app/.local/runs` and bind-mounts
  `./.local/runs` there, so the host tool and the container see the same files. Running Compose
  with `NODE_ENV=production` still starts; the mount is simply unused.
- The `upload-storage-init` service is **not** extended to own this directory.
  `scripts/verify-compose-upload-storage.mjs` pins its command to a reviewed fixed-path
  allowlist and rejects any other `/app/` path, and that guard stays as it is. Consequence: on
  Docker Desktop (the owner's machine) the bind mount is writable by the container user as is;
  on a Linux host the directory may belong to another user. When the recorder cannot write, it
  turns itself off, the app starts normally, startup logs the reason, and `runs doctor` prints
  the one command that fixes the ownership.

### 5.4 Agent interface

`scripts/runs.ts`, run through `tsx` as `npm run runs -- <command>`:

| Command | Purpose |
|---|---|
| `doctor` | Is the recorder on in the running stack, where does it write, is the directory shared with the container |
| `tail [--failed]` | Follow `index.log` live |
| `list [--failed] [--since <duration>]` | One line per run |
| `show <runId or operationId or last> [--full]` | The run as a compact tree |
| `fixture <runId> --expect <outcome>` | Export a replay fixture (5.6) |

`list` and `show` accept `--json`.

Live work: the agent watches `index.log` for lines starting with `RUN-FAIL` or `RUN-BLOCKED`,
then calls `show`. `--failed` means `RUN-FAIL` and `RUN-BLOCKED` runs.

Illustrative `show last` (values invented):

```
RUN-FAIL 7f3a91c2 olx publish seam=adapter.http op=b41e-0c7d
http    POST /api/listings/:id/publish -> 202 41ms
graph   publication-preflight@1 load ok, eligibility ok, account ok, category ok, quota ok
queue   publish:b41e-0c7d attempt 1/3 failed 612ms
adapter olx:publish PROVIDER_REJECTION retryable=false
        POST <olx> /api/partner/adverts -> 400
        res {"error":{"validation":[{"field":"attributes.state"}]}}
attempt b41e-0c7d status=publishing
queue   attempt 2/3 failed: InvalidStateError "ambiguous in-flight marketplace publish"
at      src/backend/infrastructure/adapters/OLXAdapter.ts:<line>
next    npm run runs -- fixture 7f3a91c2 --expect <outcome>
```

### 5.5 Redaction

One choke point: the file writer accepts only a branded `Sanitized<T>` value, and the only way
to make one is the sanitizer.

1. **Shape.** Exchanges enter through one typed function. Headers are allowlisted; `Authorization`
   and cookies are never copied. Query strings are dropped. Host and path are separate fields.
2. **Keys.** Values under keys matching a denylist (`token`, `secret`, `password`, `authorization`,
   `refresh`, `code`, `state`, `client_id`, `key`, and the provider-specific ones) are replaced.
3. **Values.** A secret registry, one per process, holds the secret `.env` values (an explicit
   list derived from the env schema, generalizing `startupSensitiveValues` in `main.ts`, not all
   of `process.env`) and every marketplace token the process handles. Tokens are registered at
   the two places they enter memory: where a stored credential is decrypted and where an OAuth
   response is parsed. A token issued by an earlier process is therefore registered when this
   process decrypts it, before it can be used. A match is replaced with a named placeholder such
   as `[ENV:HERMES_API_KEY]`; the event is kept. Bearer, JWT and long-token patterns are
   replaced too, as the backstop for anything the registry missed.
4. **Order.** The scan runs on decoded string values, including error messages and pg `detail`,
   before serialization and before truncation. Bodies are capped after the scan.

Tracked fixtures get a second, stricter gate (5.6).

Tests: a canary test plants secrets at every seam and asserts none reach a file; a companion test
asserts that an ordinary breaking field (for example a validation error naming a field) survives
sanitization.

### 5.6 From failure to regression test

- `npm run runs -- fixture <runId> --expect <outcome>` writes one JSON file to
  `src/backend/__tests__/fixtures/publish-runs/<slug>.json`. `--expect` is mandatory, so the
  fixture is red until the code is fixed.
- The fixture holds: the job payload, the ordered marketplace exchanges per Bull attempt, the
  observed outcome and the expected outcome. For a preflight refusal it holds the listing,
  product and marketplace snapshot instead of exchanges.
- `--expect` takes `published` or `error:<CODE>`, where `<CODE>` is the error code the run should
  end with (a `MarketplaceError` or `DomainError` code). An optional `--attempt-status <status>`
  adds an assertion on the final `publish_attempts` status. The observed outcome is stored in
  the same vocabulary.
- **Fixtures are built from an allowlist of fields.** What the allowlist keeps as recorded:
  structure (keys and value types), numbers, booleans, and marketplace vocabulary such as
  category ids, attribute codes, condition and status values, and error codes. What it replaces
  with synthetic values of the same type: ids, titles, descriptions, contact data, image URLs
  and any other seller-authored text. Marketplace response bodies keep their structure, field
  names and error codes; free-text messages in them are kept only when they contain no replaced
  value. Fields the allowlist does not know are dropped and named in the command output. The
  export refuses to write when a secret pattern or a canary marker remains.
- A failure that depends on the exact seller text (a banned word, a length limit) does not
  survive this. The command says so when the recorded response names a replaced field, and the
  agent then writes that one synthetic value by hand to reproduce the condition.
- One table-driven test, `publishRunReplay.test.ts`, loads every fixture. Worker failures replay
  through `PublishListingHandler.handle`, once per recorded attempt, with a replay HTTP client
  and in-memory stores. The replay client matches requests by order, method and path, answers
  with the recorded response, and asserts that the request body has the recorded key set; an
  unmatched or leftover exchange fails the case. Preflight refusals replay through
  `PublishListingUseCase.execute` over in-memory repositories seeded from the snapshot.

Limits, stated so nobody expects more: failures that depend on real Postgres or Redis behaviour
(locks, Bull stalls) are recorded but not replayable; quota state in a preflight replay is the
recorded decision, not a re-computation.

### 5.7 Marketplace readiness

Contract for a new adapter, enforced rather than documented:

- It extends `BaseMarketplaceAdapter`, does all I/O through the injected `http`, throws
  `HttpError` or `MarketplaceError`, and is registered in `MarketplaceAdapterFactory`.
- ESLint forbids global `fetch` under `infrastructure/adapters/**` except in
  `FetchMarketplaceHttpClient.ts`.
- A contract test iterates the factory keys and asserts, for each, that a failing stub exchange
  produces `adapter.op` and `adapter.http` events and a replayable fixture.

Nothing in the recorder, the tool or the replay test names OLX.

### 5.8 Graph and AI guard

"A guard for LangChain" here means deterministic checks, since neither graph calls a model
directly:

1. `guardedNode(graph, node, { requires, provides }, fn)` replaces the plain node functions in
   `PublishListingUseCase.preflightGraph()` and `ProductAssistanceGraph`. It emits the
   `graph.node` events, fails with a typed `GraphInvariantError` when a required channel is
   missing or a declared output is absent, and removes the need for `state.listing!`.
   `GraphInvariantError` is not a `DomainError`, so it answers 500 and is logged.
2. Both `invoke` calls get an explicit step limit and a time limit.
3. `GuardedAIProvider` decorates `IAIProvider`: zod validation of every method's output for both
   the Hermes and the offline provider, a per-run call cap and a timeout. A violation is a typed
   error recorded with issue paths only.
4. A shape test: the compiled preflight graph's nodes and edges must match what
   `PUBLICATION_PREFLIGHT_GRAPH_VERSION` declares, so the graph cannot change without a version
   bump. The same for `product-assistance@1`.
5. ESLint restricts `@langchain/*` imports to the application layer.

The guard changes behaviour only for states that are already bugs (a missing channel, an invalid
provider answer, a runaway graph).

### 5.9 Safety of the publish path

- Every recorder call is wrapped: a recorder fault is logged once and swallowed. A test injects a
  throwing recorder and asserts the publish result is unchanged.
- With the recorder off, the queue wrapper adds nothing to job data, and the recording HTTP
  client is a pass-through.
- The worker accepts jobs with or without a run id.

## 6. Delivery

Five pull requests, each useful alone:

| # | Content | Size |
|---|---|---|
| 1 | Run context, sanitizer and canary tests, file recorder, `http` and `queue` events, 4xx visibility, `runs doctor / list / show / tail`, Compose mount, docs | M |
| 2 | `graph.node`, `adapter.op`, `adapter.http`, `ai.call`, `attempt` and `error` events; `RUN-FAIL` / `RUN-RETRY` lines | M |
| 3 | `runs fixture`, the allowlist export, the table-driven replay test | M |
| 4 | Graph and AI guard, shape tests, `@langchain/*` import boundary | M |
| 5 | Adapter contract test, `fetch` lint rule, the working-loop section in `docs/development.md` | S |

After pull request 2 the owner can already publish by hand and the agent can read the run.

Pull request 2 introduces the node wrapper and the `IAIProvider` decorator as recording-only.
Pull request 4 extends the same two pieces with the checks of 5.8 (the wrapper becomes
`guardedNode`, the decorator becomes `GuardedAIProvider`); it does not add a second layer.

## 7. Calls made by the author (not decided by the owner)

- Names: `runId`, `X-Run-Id`, `npm run runs`, `.local/runs/`, `RUN-FAIL`.
- Recorder on by default in development, off switch `RUN_RECORDER=off`.
- No browser error capture in this design.
- The run id travels in the queue wrapper as a reserved `__run` key, not in the job types.
- An expected guard refusal is `RUN-BLOCKED`, separate from `RUN-FAIL`, and both wake the agent.
- `--expect` vocabulary: `published` or `error:<CODE>`.
- Seller text is never kept in a tracked fixture, at the cost of hand-reproducing failures that
  depend on the exact text.
- One table-driven replay test and JSON fixtures, not a generated test file per bug.
- Tracked fixtures use synthetic values from an allowlist.
- The masking defect in Appendix A is a separate task, taken first once the recorder shows it.

## 8. Left to the builder

- The exact event schema and the `--json` shape, as long as section 5.2 is covered.
- How the ambient context exposes the recorder to the base adapter.
- The denylist contents beyond those named, and the env-schema source for the secret list.
- Whether the step and time limits use LangGraph's own options or a wrapper, after checking the
  installed `@langchain/langgraph`.
- Reuse of existing test fakes for the replay harness.

## Appendix A. First defect the recorder will show

In `PublishListingHandler.handle` the publish branch calls `preparedPublish.execute()` with no
error handling around it, while the quota step just above it marks the attempt abandoned on
failure. When the marketplace refuses the advert, the attempt stays in `publishing`, and Bull
retries then fail with "ambiguous in-flight marketplace publish", which hides the first error.
Part of this may be a deliberate fence against double publication, so the fix has to tell a
definite refusal from an unknown outcome. Not part of this design.

## Appendix B. Reported by the design review, to confirm while planning

Read by reviewers, not re-checked by the author: `redactSensitiveText` blanks every URL;
`ProductAssistanceGraph.ts` already has a private `traced` / `observe` hook to generalize;
`MarketplaceError` messages embed a stringified provider body; `container.ts` constructs
`FetchMarketplaceHttpClient` in six places; only two AI provider methods are zod-parsed today,
inside the graph; the experiment bundle writer in `src/backend/experiments/` refuses real traces
on purpose and is not extended.
