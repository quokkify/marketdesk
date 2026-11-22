# Task: observable AI graph runs for product assistance

> **Handoff brief for the implementation agent.** Read the interactive visual reference
> first: `docs/design/prototypes/assistance-graph-runs.html` (serve the repo root and open
> `/docs/design/prototypes/assistance-graph-runs.html`; it is a static,
> dependency-free prototype).
> The prototype's controls, mock timings, mock tokens and dollar values are **not**
> part of the product. The interaction model, information hierarchy and visual language
> are the reference.
>
> Implement the feature in the existing MarketDesk application. Do not copy the prototype
> CSS or keep demo controls. Use the existing MUI theme, RTK Query, Express/Postgres,
> Bull/Redis and LangGraph code.

## 1. Handoff summary

Today all three AI assistance actions are synchronous HTTP requests:

- `POST /api/products/ai-draft` → `ProductAIDraft`
- `POST /api/products/:id/improvements` → `ProductImprovementSuggestions`
- `POST /api/products/:id/recheck` → `ProductRecheckResult`

The graph (`ProductAssistanceGraph`) has a node-lifecycle observer, but production wiring
passes `undefined`, and the frontend has no run model, phase limits, token usage or
post-hoc trace. The UI disables the action button and shows the result only after the
whole request finishes.

Deliver an end-to-end vertical slice:

1. Starting an AI assistance action returns immediately (HTTP `202`) and never blocks the
   page.
2. A global activity indicator shows active runs. Hovering it (or an inline run row)
   shows a live popover with the current phase, elapsed/limit, tokens and status.
3. A short “How this graph works” block explains the phase plan; clicking a phase or a
   run opens a full trace/history drawer.
4. Every phase has a hard timeout and a global deadline. Timeouts are first-class,
   persisted, shown in the UI and never reported as success.

Token usage must come from the provider. If the provider does not report usage, show
`—`, never a fabricated estimate. Cost is an explicitly labelled estimate.

## 2. Non-goals

- No graph editor, no user-authored graphs, no plugin system.
- No new WebSocket/SSE client in v1. The backend already has an unused
  `/api/hermes/live` WebSocket; do not wire it for this feature. Poll the run snapshot.
- No provider retry logic in this slice. The phase plan metadata must not claim a retry
  that is not implemented.
- No partial AI result is displayed as if the run succeeded. Completed phases and spent
  tokens are visible after a timeout/failure; the result is only returned for
  `completed`.
- Do not change the existing Hermes `Analyze` action in this slice; it is a separate flow.
- Do not add demo/scenario selectors to the product UI.

## 3. User-visible acceptance

### 3.1 Non-blocking start

- Clicking “Suggest improvements”, “Recheck publication”, or the wizard's AI-draft
  action sends the start request and returns control to the user. No modal/dialog is
  opened by the action.
- The page remains scrollable and other controls remain usable while the run executes.
- If a run for the same action/product is already active, do not start a duplicate:
  focus/open the existing run. The server also enforces this (see §5.5).
- Starting a run shows an inline row immediately (from the `202` response) and the
  global activity indicator within one poll.

### 3.2 Hover popover

Hovering the global indicator or an inline run row opens an interactive popover:

- Graph name and `product-assistance@1` version.
- Status: queued / running / completed / timed out / failed.
- Current phase name and `elapsed / limit`.
- A progress bar for the current phase's timeout, warning at ≥75%, danger at 100%.
- All phases in order with status, elapsed, limit and reported tokens.
- Aggregate reported tokens, estimated cost (only when usage exists), and
  `elapsed / graph deadline`.
- A link/button “Full trace →”.
- The popover must stay open while the pointer is inside it and must be keyboard
  reachable (`focus` opens it, `Escape` closes it).
- Updates arrive at least every second while running.

### 3.3 Phase explanation and trace drawer

- A compact “How this graph works” panel on the product detail page (and in the
  wizard where an AI draft is available) shows:
  - graph summary,
  - phase chips with labels and limits,
  - one line explaining that phases have hard limits and nothing is auto-applied.
- Clicking a phase chip or “Full graph” opens a right-side drawer with:
  - **Overview**: summary, deadline, token budget/typical usage if known, mode
    `review-only`, graph map, per-phase descriptions, model/provider label, timeout,
    retry (`none` in v1), inputs/outputs, guardrails.
  - **Live trace**: status, total elapsed, tokens, estimated cost, phase timeline with
    timings/limits, phase detail, and the final result/error when terminal.
  - **Run history**: recent runs for the current product or workspace (id, graph,
    started, status, duration, tokens, cost), each opening its trace.
- The drawer is user-invoked and modal (focus trap, close button, Escape, overlay).
  It is not shown automatically when a run finishes; a non-blocking toast is used.

### 3.4 Timeouts

- Each phase has a hard limit; the current phase bar shows the countdown.
- A phase that exceeds its limit becomes `timed_out`, the run becomes `timed_out`, and
  the UI says which phase and which limit.
- The provider request is actually aborted; do not leave the HTTP call running after
  the phase has timed out.
- Tokens already reported remain visible.
- A global graph deadline is also enforced. If it fires, the current phase is
  `timed_out` and the run records that the deadline was reached.
- The UI never displays a timed-out/failed run as completed or applies its result.

## 4. Current state (verified in the repository)

### Backend

- `src/backend/application/services/ProductAssistanceGraph.ts`
  - `ProductAssistanceGraph` compiles one LangGraph in the constructor.
  - `AssistanceTransition` = `{ node: 'route' | 'draft' | 'publication' | 'improve',
    phase: 'started' | 'completed' | 'failed' }`.
  - The optional constructor `observe` callback is wired to `undefined` in production:
    `src/backend/config/di/container.ts` around the `new ProductAssistanceGraph(...)` call.
  - `improve` is one node that loads product/listing/marketplace, calls
    `ai.analyzeListingSeo`, calls `ai.suggestPrice`, and assembles the result.
  - `generateDraft`, `publicationReview`, `proposeImprovements` all call
    `this.graph.invoke(...)` and are synchronous from the caller's point of view.
- `src/backend/presentation/http/controllers/ProductController.ts`
  - `generateAIDraft`, `recheck`, `proposeImprovements` are synchronous.
- `src/backend/presentation/http/routes/products.ts`
  - Routes at lines ~21–25.
- `src/backend/infrastructure/external/HermesAI.ts`
  - Implements `IAIProvider`; calls `AITextCompletionClient.complete`.
- `src/backend/infrastructure/external/HermesCompletionClient.ts`
  - OpenAI-compatible `/chat/completions` call with `AbortSignal.timeout`.
  - Response type currently ignores `body.usage`.
- `src/backend/domain/ports/IAIProvider.ts`
  - No usage/signal context on any call.
- `src/backend/application/services/ProductAIDraftService.ts`
  - `enrichWithAI` calls `generateTitle` and `analyzeListing` in parallel and swallows
    provider errors into an offline fallback.
- `src/backend/application/services/ProductRecheckService.ts`
  - No AI call; deterministic checks. A recheck run has no token usage.
- `src/backend/application/ports/IJobQueue.ts`
  - Application-owned job payload contracts; Bull `ManagedQueue` is wired in
    `src/backend/config/di/container.ts`.
- `src/backend/infrastructure/persistence/schema.sql` + `src/backend/persistence/migrations/`
  - Ordered idempotent SQL migrations; latest is `043_…`. Add `044_…`.
- `src/backend/presentation/websocket/HermesLiveUpdates.ts`
  - Existing WebSocket server and event broker; **no frontend consumer**. Not used here.
- `src/backend/main.ts`
  - Builds the HTTP server, attaches the Hermes WS, owns shutdown.
- `src/backend/experiments/ProductAssistanceExperiment.ts`
  - Uses the constructor observer and asserts the exact transition sequence in
    `src/backend/experiments/__tests__/ProductAssistanceExperiment.test.ts`.
  - The experiment must remain runnable and its expected sequence must be updated.

### Frontend

- `src/frontend/pages/ListingDetailsPage.tsx`
  - `handleProposeImprovements` and `handleRecheck` await the mutations and then update
    local state.
  - `ProductHermesCard` receives `suggesting` / `rechecking` and disables its buttons.
  - Results are rendered inline in the existing cards.
- `src/frontend/components/product-detail/ProductDetailSections.tsx`
  - `ProductHermesCard` — the AI action card.
  - `PublicationReadinessSection` / `PublicationReadinessAction` — recheck UI.
- `src/frontend/pages/ProductsPage.tsx`
  - `onGenerateAIDraft={(request) => generateProductAIDraft(request).unwrap()}` at the
    wizard mount.
- `src/frontend/components/forms/ProductWizardForm.tsx`
  - `requestDraft` awaits `onGenerateAIDraft`; the wizard button is disabled while it
    runs.
- `src/frontend/state/api/productsApi.ts`
  - Existing mutations: `generateProductAIDraft`, `proposeProductImprovements`,
    `recheckProduct`.
- `src/frontend/components/layout/TopBar.tsx`
  - Global action area; add the run indicator before the theme toggle/notifications.
- `src/frontend/components/layout/AppShell.tsx`
  - Mount the global trace drawer next to `TopBar`.
- `src/frontend/pages/HermesActivityPage.tsx`
  - Existing activity feed; optional home for a graph/run history panel.
- `src/frontend/state/api/baseApi.ts`
  - Add an `AssistanceRun` cache tag if tags are used.
- `src/frontend/state/slices/uiSlice.ts`
  - Existing toast queue; reuse `enqueueToast`.

### Tests and conventions

- `src/backend/application/services/__tests__/ProductAssistanceGraph.test.ts`
- `src/backend/presentation/__tests__/api.integration.test.ts`
- `src/backend/experiments/__tests__/ProductAssistanceExperiment.test.ts`
- `src/frontend/pages/ListingDetailsPage.test.tsx`
- `src/frontend/state/api/productsApi.test.ts`
- Jest + Testing Library; `src/backend/domain/testkit/support.ts` and
  `src/backend/infrastructure/testkit/support.ts` provide in-memory fakes.
- Frontend tests render with Redux/theme/router providers; follow the existing tests.
- Migrations are idempotent; update both `schema.sql` and a new ordered migration.

## 5. Design decisions to implement

### 5.1 Async execution and transport

Use the existing Bull/Redis managed queue plus Postgres for run state.

- New queue: `assistance-run` (`createQueue<AssistanceRunJob>('assistance-run')`).
- `POST /api/assistance/runs` validates and persists a `queued` run, enqueues
  `{ runId, workspaceId }`, and returns `202` with the run snapshot.
- The queue handler calls `AssistanceRunService.execute(runId)`.
- The UI polls `GET /api/assistance/runs/:id` (~1 s) and
  `GET /api/assistance/runs?status=active` (~2 s for the global indicator).
- This is deliberately polling rather than the unused Hermes WS: it is
  multi-instance-safe, survives reconnects, and reuses existing RTK Query patterns.

If the queue cannot be enqueued, mark the run `failed` with a safe error and return
`503` from the start endpoint; do not return a run that will never execute.

### 5.2 Run model and phases

The phase is the UI unit. It must map to real work; do not invent decorative phases.

Initial plans (single source of truth in `src/shared/assistanceGraphs.ts`):

**improve** — deadline 20 s

| key | label | kind | limit |
| --- | --- | --- | --- |
| `route` | Route | router | 1000 ms |
| `load_context` | Load context | io | 2000 ms |
| `seo` | SEO copy | llm | 8000 ms |
| `price` | Price | llm | 6000 ms |
| `assemble` | Assemble | guard | 1000 ms |

**draft** — deadline 12 s

| key | label | kind | limit |
| --- | --- | --- | --- |
| `route` | Route | router | 1000 ms |
| `draft` | Draft copy | llm | 8000 ms |

**publication** — deadline 12 s

| key | label | kind | limit |
| --- | --- | --- | --- |
| `route` | Route | router | 1000 ms |
| `recheck` | Publication checks | guard | 10000 ms |

Rules:

- `route` is shared by all kinds and emits its own phase.
- `improve` must be refactored from one node into
  `load_context → seo → price → assemble` plus the shared `route`.
- `draft` is the call to `ProductAIDraftService`; the service's existing offline fallback
  remains. Report its usage under the `draft` phase. Do not add an `assemble` phase
  unless it actually validates/assemble something the service does not already do.
- `publication` is the existing `ProductRecheckService.recheck`; no AI call, no token
  usage. Do not invent phases inside it. `recheck` may be one phase.
- Phase labels/limits/descriptions live in the shared plan. The backend enforces the
  limits; the frontend renders the same plan. Historical runs store the resolved
  labels/limits in `phases`.
- Model label: `Hermes agent` (the actual model is chosen by Hermes). Do not hard-code
  `gpt-4.1-mini` from the prototype.
- Retry: `none` in this slice. If you implement retry, make it real and test it; do not
  display a claim.

### 5.3 Token usage

Usage must be provider-reported and nullable.

- Add `AiUsage`:
  ```ts
  export interface AiUsage {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  }
  ```
- Extend `AICompletionRequest` (HermesAI.ts) with:
  ```ts
  onUsage?: (usage: AiUsage) => void;
  signal?: AbortSignal;
  ```
- `HermesCompletionClient` parses the OpenAI-compatible `body.usage`
  (`prompt_tokens`, `completion_tokens`, `total_tokens`) and calls `onUsage` once.
  Missing/invalid usage = no callback.
- Extend `IAIProvider` calls with an optional final `AiCallContext`:
  ```ts
  export interface AiCallContext {
    onUsage?: (usage: AiUsage) => void;
    signal?: AbortSignal;
  }
  ```
  Update `HermesAI`, `AIProviderSelector`, `OfflineHeuristicAIProvider` and test fakes.
  Optional parameters must not break existing callers; update Jest assertions that
  expect exact argument lists.
- `ProductAIDraftService.generateDraft(input, context?)` forwards the context to both
  `generateTitle` and `analyzeListing`.
- `ProductAssistanceGraph` forwards a phase-scoped callback:
  ```ts
  (usage) => observer?.onUsage('seo', usage)
  ```
  The draft service's two parallel calls both report into the `draft` phase.
- The run and each phase store usage. Aggregate only reported values. If no phase
  reported usage, the run usage is `null` (not `0`). The UI shows `—`.
- Cost estimate is opt-in via config/env (e.g. `AI_ESTIMATED_COST_PER_MILLION_TOKENS`).
  If configured and tokens exist, compute `estimatedCostUsd`; label it “est.”. If not,
  show tokens only. Never present the estimate as provider billing.
- Late usage after a timeout must be ignored once the phase/run is terminal. The UI must
  not increase the count after the timeout is shown.

### 5.4 Timeout and abort

- Add `PhaseTimeoutError` in the application layer:
  ```ts
  export class PhaseTimeoutError extends Error {
    readonly code = 'PHASE_TIMEOUT';
  }
  ```
- Implement a phase runner:
  ```ts
  async function withPhaseTimeout<T>(
    limitMs: number,
    run: (signal: AbortSignal) => Promise<T>,
    runSignal?: AbortSignal,
  ): Promise<T>
  ```
  - Creates an `AbortController`; aborts after `limitMs`.
  - Combines `runSignal` (global deadline) and the phase signal using
    `AbortSignal.any`.
  - Passes the combined signal to the AI call context.
  - On abort, throws `PhaseTimeoutError`; distinguish phase timeout from run deadline.
- `HermesCompletionClient` passes `request.signal` to `fetch`, combined with the existing
  provider timeout (`AbortSignal.any`). This ensures the model request is actually
  aborted, not just raced and left running.
- The graph's traced wrapper:
  - emits `started` before the call;
  - emits `completed` with `durationMs`;
  - emits `timed_out` for `PhaseTimeoutError`;
  - emits `failed` for other errors.
- The run-level deadline is enforced by the run service; if it fires, abort the run
  signal, mark the current phase/run `timed_out`, and persist.
- A run that fails before any phase starts still has a safe terminal status and error.
- Note on non-AI phases: `ProductRecheckService` does DB/OAuth work without an
  `AbortSignal`. A timeout must still stop the run from reporting success and must not
  apply its result; the in-flight work may finish. Do not claim the work was cancelled.
  If cancellation of the recheck itself is required, thread a signal through its I/O in a
  follow-up; do not fake it in the UI.

### 5.5 Concurrency, duplicates, tenancy

- Max 3 active (`queued`/`running`) runs per workspace; a new start beyond the limit
  returns `409` with a stable error code.
- A duplicate active run for the same `(workspaceId, productId, kind)` returns `409`
  with the active `runId` in `details` so the UI can focus it. For `draft`, key by
  workspace + kind (no product).
- All reads/writes are scoped by `workspaceId` from the JWT. The request body must never
  decide the workspace.
- `GET /runs/:id` for another workspace returns `404`, not `403`.
- Validate that the product/listing belongs to the workspace before enqueuing; return
  `404` for unknown/cross-workspace IDs. The graph's own checks remain as defense in
  depth.
- Errors returned in the run are sanitized `{ code, message }`; never store raw
  provider bodies, prompts, headers or secrets. Log a redacted cause with
  `redactSensitiveText` / the existing logger.

### 5.6 Persistence and retention

Create `assistance_runs` in `schema.sql` and `044_assistance_runs.sql`:

```sql
CREATE TABLE IF NOT EXISTS assistance_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('improve', 'draft', 'publication')),
  graph_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'timed_out', 'failed', 'interrupted')
  ),
  phase_index INT NOT NULL DEFAULT 0,
  phases JSONB NOT NULL,
  result JSONB,
  usage JSONB,
  estimated_cost_usd NUMERIC(12, 6),
  error JSONB,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assistance_runs_active
  ON assistance_runs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_runs_product
  ON assistance_runs (workspace_id, product_id, created_at DESC);
```

- `phases` is the JSON array of `AssistancePhase` snapshots (label, kind, limit, status,
  timestamps, usage, safe error).
- `result` is the union payload, only for `completed`.
- `usage` is the aggregate or `NULL`.
- The repository interface:
  - `create(run): Promise<void>`
  - `findByIdForWorkspace(id, workspaceId): Promise<AssistanceRun | null>`
  - `listForWorkspace({ workspaceId, productId?, status?, limit }): Promise<AssistanceRunSummary[]>`
  - `save(run): Promise<void>` (serialized per run; see below)
- Serialize persists per run so two parallel usage callbacks cannot overwrite each
  other out of order. Either await each persist or use a per-run promise chain and write
  a snapshot. Keep the in-memory run object authoritative during execution; the DB is
  authoritative for reads after a restart.
- On boot, reconcile stale `queued`/`running` rows older than their deadline to
  `interrupted` (or fail them with a safe message) so the UI never shows a ghost run
  forever. Keep this small and tested.
- Retention: v1 may keep all runs. If you add cleanup, make it a separate scheduled
  job; do not hide history by default.

## 6. Contracts

### 6.1 Shared types (`src/shared/types/assistance.ts`)

```ts
export type AssistanceRunKind = 'improve' | 'draft' | 'publication';
export type AssistanceRunStatus =
  | 'queued' | 'running' | 'completed' | 'timed_out' | 'failed' | 'interrupted';
export type AssistancePhaseStatus =
  | 'pending' | 'running' | 'completed' | 'timed_out' | 'failed';
export type AssistancePhaseKind = 'router' | 'io' | 'llm' | 'guard';

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AssistancePhase {
  key: string;
  label: string;
  kind: AssistancePhaseKind;
  limitMs: number;
  status: AssistancePhaseStatus;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  usage: AiUsage | null;
  error: { code: string; message: string } | null;
}

export interface AssistanceRunSummary {
  id: string;
  workspaceId: string;
  productId: string | null;
  listingId: string | null;
  kind: AssistanceRunKind;
  graphVersion: string;
  status: AssistanceRunStatus;
  phaseIndex: number;
  phases: AssistancePhase[];
  usage: AiUsage | null;
  estimatedCostUsd: number | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AssistanceRun extends AssistanceRunSummary {
  result:
    | { kind: 'improve'; value: ProductImprovementSuggestions }
    | { kind: 'draft'; value: ProductAIDraft }
    | { kind: 'publication'; value: ProductRecheckResult }
    | null;
}
```

- `elapsedMs` is a server-computed snapshot value. The client may tick locally between
  polls from the last response time, but must not invent a phase start time.
- `phase.error` uses stable codes (`PHASE_TIMEOUT`, `PROVIDER_UNAVAILABLE`,
  `INVALID_OUTPUT`, `NOT_FOUND`, `INTERNAL`), not raw exception text.
- Add `AssistanceRun` to `src/shared/types/index.ts` exports.

### 6.2 Graph plan (`src/shared/assistanceGraphs.ts`)

```ts
export interface AssistancePhasePlan {
  key: string;
  label: string;
  kind: AssistancePhaseKind;
  limitMs: number;
  description: string;
  model: string | null; // null for non-LLM phases
}

export interface AssistanceGraphPlan {
  kind: AssistanceRunKind;
  version: 'product-assistance@1';
  label: string;
  summary: string;
  deadlineMs: number;
  phases: AssistancePhasePlan[];
}

export const ASSISTANCE_GRAPH_PLANS: Record<AssistanceRunKind, AssistanceGraphPlan>;
```

- The descriptions are user-facing and must match the implementation. Include the
  review-only/guardrail wording for improve and draft.
- The plan is used by the backend for limits/labels and by the frontend for the
  explainer/drawer. Do not duplicate the phase list in two places.
- The backend's run `phases` are seeded from the plan at run creation; the frontend can
  render them before the first poll.

### 6.3 HTTP API

All routes are under `/api`, authenticated by the existing guard, workspace-scoped, and
use the existing success/error envelope (`ok`, `fail`, `created`/`ok(..., 202)`).

```
POST /api/assistance/runs
  body:
    { kind: 'improve', productId, listingId? }
    { kind: 'publication', productId, listingId }
    { kind: 'draft', request: ProductAIDraftRequest }
  202 { success: true, data: AssistanceRun }   // status queued, phases pending

GET /api/assistance/runs/:runId
  200 { success: true, data: AssistanceRun }

GET /api/assistance/runs?status=active&productId=...&limit=20
  200 { success: true, data: AssistanceRunSummary[] }
```

- `status=active` means `queued` or `running`. The list is ordered newest first and
  limited (max 50).
- `GET /runs/:runId` includes `result`; the list omits `result` and returns summaries.
- Add a `POST /runs/:runId/cancel` only if you implement cancellation end-to-end;
  otherwise do not expose a dead control.
- Add validation schemas in `src/backend/presentation/http/validation/schemas.ts`
  (zod) and a dedicated `AssistanceController` + `assistance.ts` routes file.
- Add `AssistanceController` to `ApiControllers`, mount at `/assistance` with the same
  `guard` array in `src/backend/presentation/http/routes/index.ts`.
- Add `assistanceService` (or the run service) to `AppDeps` and the container.
- Keep the existing synchronous product routes; they remain covered by existing tests.
  Once the UI no longer uses the old frontend hooks, remove those hooks (not the
  server endpoints) or mark them legacy. Do not leave unused hooks if the repo prefers
  clean cutover.

### 6.4 Observer contract

```ts
export interface AssistanceRunObserver {
  onTransition(event: AssistanceTransition): void;
  onUsage(phaseKey: string, usage: AiUsage): void;
}
```

- `AssistanceTransition` should be extended so the run store can persist phase
  lifecycle:
  ```ts
  export interface AssistanceTransition {
    node: string; // phase key
    phase: 'started' | 'completed' | 'timed_out' | 'failed';
    durationMs?: number;
    errorCode?: string;
  }
  ```
  Keep the existing `AssistanceTransition` export compatible enough for the experiment,
  or update the experiment's assertions in the same PR.
- The graph's public methods accept an optional per-invocation observer:
  ```ts
  generateDraft(workspaceId, request, observer?)
  publicationReview(request, observer?)
  proposeImprovements(input, observer?)
  ```
  Keep the constructor observer as the default for backward compatibility if
  practical; the per-invocation observer wins. Because the graph must bind the observer
  per run, compile the LangGraph per invocation (cheap relative to model calls) or use
  another explicit per-run binding. Do not share a mutable observer across concurrent
  runs.
- The run service creates one observer per run, persists each event, and passes the
  `AbortSignal`/usage context through.

## 7. Backend implementation steps

Do these in order; keep each step reviewable.

1. **Shared contracts**
   - Add `src/shared/types/assistance.ts`, export from `src/shared/types/index.ts`.
   - Add `src/shared/assistanceGraphs.ts`.
   - Add unit tests for plan immutability/limits if the repo has a convention for
     shared data tests (otherwise cover via backend/frontend tests).

2. **Usage plumbing**
   - Extend `src/backend/domain/ports/IAIProvider.ts` with `AiCallContext` and optional
     final parameters.
   - Update `HermesAI.ts`, `HermesCompletionClient.ts`, `AIProviderSelector.ts`,
     `OfflineHeuristicAIProvider.ts`.
   - Update `ProductAIDraftService.generateDraft` to accept and forward the context.
   - Tests: usage parsed, missing usage, abort signal forwarded, offline provider
     accepted, no provider secrets in errors.

3. **Phase-aware graph**
   - Refactor `ProductAssistanceGraph` into:
     `route → load_context → seo → price → assemble` for improve;
     `route → draft` for draft; `route → publication` for publication.
   - Extend the graph state with `product`, `listing`, `marketplace`, `seo` and `price`
     fields: `load_context` fills the scoped entities, `seo` and `price` call the
     provider (with the phase signal/usage callback), and `assemble` builds the
     review-only result without writing anything.
   - Add phase runner/timeout; pass the phase signal into AI calls.
   - Emit started/completed/timed_out/failed transitions and usage.
   - Update `ProductAssistanceExperiment` and its expected transition sequence/docs.
   - Tests: ordering, phase durations, timeout, abort, usage attribution, no writes,
     workspace scoping, sandbox views behavior (existing tests must stay green).

4. **Run persistence**
   - Add `src/backend/application/assistance/AssistanceRunService.ts` (or equivalent),
     `IAssistanceRunRepository` and a Postgres implementation.
   - Add `schema.sql` table and `044_assistance_runs.sql`.
   - Seed phases from the shared plan; persist status/phases/usage/result/error.
   - Serialize persistence per run; compute `elapsedMs` and aggregate usage.
   - Add stale-run reconciliation.

5. **Queue**
   - Add `AssistanceRunJob` to `IJobQueue.ts`.
   - Create/register `assistance-run` in the container; add it to the shutdown list.
   - The handler invokes the run service; catch errors in the service and mark the run
     terminal. Do not retry an AI run automatically in this slice.

6. **HTTP**
   - Add zod schemas, `AssistanceController`, routes, and wiring.
   - Enforce workspace scope, active-run limit 3, duplicate-active 409, 404 semantics.
   - Return `202` with the queued snapshot.
   - Add `GET` list/detail with a max limit.

7. **Wiring**
   - Construct the repository, service and queue in `container.ts`.
   - Pass the service into `buildApp`/`AppDeps`.
   - Ensure `shutdown()` closes the queue.
   - Reconcile stale runs on startup.
   - Add logger fields `runId`, `kind`, `workspaceId`, `status`, `durationMs`,
     `tokens`; never log prompts/secrets.

8. **Docs**
   - Update `docs/spec/TRACEABILITY.md` with the new capability/row and evidence.
   - Add `docs/assistance-graph-runs.md` describing the run contract, limits, token
     semantics and polling; link it from the traceability row.
   - Do not modify the canonical PRD; this is an observability/UX addition.

## 8. Frontend implementation steps

1. **API layer**
   - Add `src/frontend/state/api/assistanceApi.ts` (injected into `baseApi`):
     - `startAssistanceRun`
     - `getAssistanceRun`
     - `getAssistanceRuns`
   - Types from `@shared/types`.
   - `unwrap` the envelope; add `AssistanceRun` to `baseApi.tagTypes` only if using
     tags; polling does not need cache invalidation, but starting a run should
     invalidate the active list (or the list's poll will pick it up).
   - Keep the old `productsApi` mutations for compatibility until the UI is fully
     migrated; then remove the unused frontend hooks if nothing else uses them.

2. **Polling hooks**
   - `useAssistanceRun(runId)`: poll 1 s while `queued`/`running`, stop on terminal.
     Use `pollingInterval` state driven by `data?.status`.
   - `useAssistanceRuns({ productId, status })`: poll 1–2 s while any result is active;
     the global indicator only needs active runs.
   - Do not create a new global state library; RTK Query is enough. A small Redux UI
     slice is fine only for which run the drawer is showing.
   - On terminal, stop polling and dispatch the existing toast. Use a ref to notify
     only once per run id.

3. **Global indicator (`TopBar`)**
   - Add `src/frontend/components/assistance/AssistanceRunIndicator.tsx`.
   - Poll active runs; hide when none.
   - Button label: `N running`, spinner, reported tokens; terminal state briefly shows
     `Completed`/`Timed out`/`Failed` if it is the most recent.
   - Hover/focus opens a non-modal popover (`Popper`) with the latest/most relevant
     run. Click opens the trace drawer.
   - Mobile: icon + count; the popover still works/traps are not required for a
     non-modal popover.
   - Place it before `ThemeToggleButton` in `TopBar`; preserve the existing disabled
     notifications control.

4. **Run row**
   - `AssistanceRunRow` used in the product card and drawer:
     - status icon, graph label, current phase + elapsed/limit, segmented phase bar,
       elapsed, reported tokens, chevron.
     - hover/focus popover; click opens the drawer trace.
     - terminal row remains visible long enough to read (or until the page changes);
       do not make it disappear instantly.
   - The row is clickable and keyboard-operable.

5. **Drawer**
   - `AssistanceRunDrawer` mounted in `AppShell`.
   - Use MUI `Drawer` (right, temporary) with a focus trap; overlay/Escape/close.
   - Tabs: Overview / Live trace / Run history.
   - Overview uses the shared plan; phases are expandable (`Accordion`/`Details`),
     showing description, model label, limit, retry=none, inputs/outputs.
   - Trace shows the run snapshot; phase click selects a detail panel. Use the live
     poll value; do not render stale completed statuses.
   - History lists runs and opens the selected trace.
   - Show a clear empty state before any run.
   - The drawer is user-invoked; never auto-open on completion. Use the toast.

6. **Product detail integration**
   - Replace the two awaiting handlers with start-run + polling:
     - “Suggest improvements” → `startAssistanceRun({kind:'improve', productId, listingId})`.
     - “Recheck publication” → `startAssistanceRun({kind:'publication', productId, listingId})`.
   - The buttons must not be disabled for the whole run; only the start request
     (milliseconds). If an active duplicate exists, focus its row/drawer.
   - Render active/recent runs for the product under the `ProductHermesCard`.
   - When the run reaches `completed`, set the existing `improvements` / `recheckResult`
     state from `run.result.value` and show the existing success toast. On
     `timed_out`/`failed`, show a non-blocking toast with the phase/limit and keep the
     trace link.
   - Keep the existing result rendering, stale checks (`productUpdatedAt`,
     `listingUpdatedAt`) and review-only copy intact.
   - Add the compact “How this graph works” panel under the AI card, fed by the shared
     plan. Clicking a phase opens the drawer overview with that phase expanded.

7. **Wizard integration**
   - `ProductsPage` starts a draft run and resolves `onGenerateAIDraft` with the run's
     `ProductAIDraft` result. Poll the run; if it times out/fails, reject with a concise
     error so the wizard's existing error UI handles it.
   - The wizard's button may remain temporarily disabled while the draft is required;
     the global indicator must still show the run and the page behind must remain
     interactive. Do not open a second modal.
   - If a draft run is active and the wizard is closed, the run continues; the global
     indicator remains. On the next wizard open, do not automatically attach an old
     draft unless the user explicitly resumes it (out of scope: document the
     limitation).

8. **Hermes AI page (optional but recommended)**
   - Add a “Runs” card/tab to `HermesActivityPage` using the same row/drawer and the
     workspace history. This is where users can inspect older runs after leaving a
     product.

9. **Accessibility and responsiveness**
   - Indicator and rows are buttons/role=button with accessible names; tooltips are
     keyboard accessible; the drawer has a focus trap and Escape.
   - Phase status must not be conveyed by color alone: include status text/icons.
   - Respect `prefers-reduced-motion`.
   - Desktop light/dark and narrow viewport; no horizontal page scroll. The prototype's
     compact lane wrapping is a guide, not a hard requirement.

## 9. Testing plan

Add tests at the narrowest level; do not pad.

### Backend unit

- `ProductAssistanceGraph`:
  - emits the exact phase sequence per kind;
  - attributes two draft AI calls to the `draft` phase;
  - emits usage only when the provider reports it;
  - marks a phase `timed_out` and aborts the signal;
  - maps provider errors to `failed` with a safe code;
  - preserves workspace scoping and sandbox-view behavior;
  - does not apply any result.
- `HermesCompletionClient`:
  - parses `usage`;
  - tolerates missing/invalid usage (no callback);
  - forwards abort signals and maps aborts to a timeout in the graph;
  - never leaks the raw body in the error.
- `AssistanceRunService`:
  - start → queued → running → completed with result;
  - duplicate active → 409/conflict;
  - timeout/failure terminal states;
  - stale-run reconciliation;
  - serialized persistence/usage accumulation.
- `AssistanceRunRepository` (integration if the repo has DB-backed repository tests):
  - workspace scoping, ordering, result/usage JSON round-trip, migration idempotence.

### Backend HTTP

Extend `src/backend/presentation/__tests__/api.integration.test.ts` or add a focused
`assistance` integration test:

- `202` start with a queued snapshot and plan;
- `GET` detail; `GET ?status=active`;
- `404` cross-workspace run/product;
- `409` duplicate active run;
- `400` invalid body;
- old synchronous product endpoints still pass.

### Frontend

- Pure helpers: status labels, `elapsedMs` formatting, phase progress, usage
  `null` handling, terminal-state detection.
- `AssistanceRunIndicator`: hidden when idle; running count/tokens; hover/focus
  popover; opens the drawer.
- `AssistanceRunRow`: phase/limit/tokens, timeout state, keyboard activation.
- Drawer: tabs, phase details, empty/history states, Escape/focus.
- `ListingDetailsPage`: start doesn't block; run result populates the existing panel;
  timeout/failure shows a safe toast; duplicate focuses the existing run.
- `ProductsPage`/wizard: draft run resolves into the wizard; failure leaves the wizard
  usable.
- `productsApi`/`assistanceApi`: URL/body/envelope contract.

### Commands

Use the repo's scripts; run only the targeted tests during development, then the
affected suites once:

```bash
npm run type-check
npm test -- ProductAssistanceGraph AssistanceRun
npm test -- src/backend/presentation/__tests__/api.integration.test.ts
npm test -- src/frontend/pages/ListingDetailsPage.test.tsx src/frontend/components/assistance
npm run lint
```

If docs/traceability changed, run:

```bash
npm run verify:spec
```

Visual check (if the Playwright suite can run against the local stack):

```bash
npm run test:visual
```

Also verify the actual UI at desktop light/dark and a narrow viewport, with a real or
deterministic delayed provider so the tooltip, timeout and drawer can be observed. Do
not rely on the static prototype as runtime evidence.

## 10. Security, tenancy and privacy

- `workspaceId` always comes from the JWT; body fields are ignored for tenancy.
- `findByIdForWorkspace`/scoped queries for every read/write. Cross-workspace 404.
- Validate product/listing ownership before enqueue; do not leak existence.
- Persist only safe result DTOs, phase labels, timings and usage. Never persist prompts,
  raw model output beyond the validated result, tokens, credentials, headers, paths or
  provider error bodies.
- Sanitize error messages with the existing `redactSensitiveText`; log the safe cause.
- Enforce the active-run limit and rate limiting through the existing guard; do not add
  an unauthenticated run endpoint.
- The run list must not expose another workspace's run IDs or results.
- Treat the run result as review-only; no automatic apply/publish.

## 11. Rollout and compatibility

- The new endpoints are additive; old synchronous endpoints remain for compatibility
  and existing tests.
- The UI migrates to the new endpoints for the three actions. Remove unused frontend
  hooks only after all callers are migrated.
- The DB migration is additive and idempotent; apply it before deploying code that
  expects the table. `schema.sql` is updated for fresh databases.
- If Redis/queue is unavailable, starting a run returns a clear `503`; the UI shows a
  toast and does not create a ghost run.
- On restart, queued jobs are processed by Bull; stale `running` rows are reconciled.
- Do not add a feature flag unless the deployment requires staged rollout; if one is
  added, hide only the new indicator/UI, not the run API contract.

## 12. Definition of done

- [ ] Clicking each of the three AI actions returns within ~1 s and leaves the page
      interactive; no blocking modal.
- [ ] A global run indicator appears and an inline run row shows the actual phase.
- [ ] Hover/focus popover shows current phase, elapsed/limit, all phases, reported
      tokens, estimated cost (or `—`) and status.
- [ ] A phase limit is enforced end to end and the provider call is aborted; the UI and
      API report `timed_out` with the phase and limit.
- [ ] Full trace drawer has Overview, Live trace and Run history; the overview explains
      the real phase plan and guardrails.
- [ ] Completed improve/recheck/draft results land in the existing UI panels; timed
      out/failed runs never apply a result.
- [ ] Usage is real provider usage or `—`; no fabricated tokens/cost.
- [ ] Workspace scoping, duplicate/concurrency rules and 404 behavior are tested.
- [ ] The existing synchronous endpoints and their tests remain green.
- [ ] The experiment's transition expectations are updated and `npm run experiment:assistance`
      still passes.
- [ ] Typecheck, lint and the targeted tests pass.
- [ ] Traceability/contract docs updated; visual evidence captured for light/dark/narrow.
- [ ] No demo controls, mock values or “coming soon” placeholders shipped.

## 13. Do not

- Do not copy the prototype's hard-coded phases/tokens/prices into production code.
- Do not show a fake spinner without a real run; do not mark a phase complete before the
  underlying work completes.
- Do not use `Promise.race` without aborting the underlying provider request.
- Do not put provider/API details or raw errors in the run snapshot returned to the
  browser.
- Do not create a second concurrent run system alongside Bull/RTK Query.
- Do not surface the unused Hermes WebSocket as a dependency for this feature.
- Do not let the drawer or toast block the page on action start.
- Do not claim exact billing or a specific model if the provider does not report it.
- Do not modify the canonical PRD to match a narrower implementation.

## 14. Decisions already made (defaults; change only with evidence)

- Polling, not WebSocket/SSE, for v1.
- Bull + Postgres, not an in-memory-only run registry.
- Max 3 active runs per workspace; duplicate active `(workspace, product, kind)` returns
  the existing run in `409.details`.
- Phase plans: improve 5 phases, draft 2, publication 2; phase labels/limits from the
  shared plan.
- No automatic retry in v1; no cancel button unless cancellation is fully implemented.
- Token usage is nullable; cost is an estimate and optional.
- The drawer is user-invoked; completion uses a toast and the inline result.

If a product decision conflicts with these defaults, record it in the PR description and
update this brief; do not silently narrow the acceptance criteria.
