# AI usage per analysis and Hermes limits — design

## Intent

The owner wants to control AI spend: see what each analysis consumed and how much of the provider's
allowance is left, both in the technical log (so the agent watching production logs catches problems)
and on a frontend page. Owner's words: "отслеживать стоимость анализа через ai … в техническом журнале
отображать, и на frontend страничке тоже — это важно" and "отображение hermes актуальный доступные
лимиты … чтобы контролировать usage". One pull request.

## Facts this rests on

- MarketDesk calls Hermes (OpenAI-compatible, profile `marketdesk`, no tools) through
  `src/backend/infrastructure/external/HermesCompletionClient.ts`; it returns only the text and drops
  the `usage` block `{prompt_tokens, completion_tokens, total_tokens}` Hermes sends with every chat
  completion (`gateway/platforms/api_server.py` `_chat_usage_payload`). Hermes builds a fresh agent
  per request, so the numbers cover that one call. The response `model` is the requested name, not the
  upstream model.
- The upstream provider is `openai-codex` (ChatGPT Plus subscription). Hermes itself classifies it as
  `subscription_included`: no invoice per call. A USD figure would be invented.
- Limits: `hermes -p marketdesk usage --json` (documented, "keys are stable; new keys may be added")
  returns the plan, a 5-hour window and a weekly window with `used_percent` and `resets_at`, plus
  `fetched_at` and `unavailable_reason`. Exit 1 with empty stdout when unavailable. The Hermes API
  server has no limits route. The quota is account-wide: other Hermes and ChatGPT use draws from it.
- LLM call sites: `ProductAssistanceGraph.ts` (improve: SEO copy, price), `ProductAIDraftService.ts`
  (draft: title, analysis), `HermesDecisionEngine.ts` (autopilot). Offline fallback is chosen in
  `AIProviderSelector.resolve()`.
- Production log is `docker logs` (pino); the run recorder is off in production.

## Goals

1. **Every AI call is recorded**: one row per call in a new `ai_usage` table and one pino line
   `AI call` with: workspace, feature, product (when known), provider (`hermes` | `offline`), tokens
   in/out/total (NULL when not reported), latency, outcome (`ok` | `unavailable` | `rejected` |
   `invalid_output`), HTTP status, run id. `warn` level when outcome is not `ok`. No prompt or
   response text, ever.
2. **Per analysis on the product page**: next to improvement and draft results, one line:
   `Hermes · 1 840 in / 412 out tokens · included in subscription`; offline: `Offline heuristics · no AI
   usage`; tokens missing: `Hermes · usage not reported`.
3. **Hermes Activity page, two cards**:
   - *Hermes limits*: plan, one bar per window with percent and reset time, "checked N min ago", caption
     "account-wide, shared with all Hermes use". Stale (older than 15 min) shows greyed values with
     "may be out of date"; unknown / not configured shows "Limits unavailable" and the reason. Warning
     colour at ≥ 80 %, error at ≥ 100 %.
   - *AI usage*: today and last 7 days — analyses (Hermes / offline / failed), tokens in/out, and a
     per-feature breakdown. Cost reads "included in subscription".
4. **Limits feed**: a timer on the host runs the `usage --json` command every 5 minutes and writes the
   JSON atomically to a file the app reads through a read-only mount. The app validates it; it never
   holds the ChatGPT OAuth token.

## Non-goals

- USD amounts or price tables (owner chose tokens + share of the limit).
- Alerts, or blocking analyses when a limit is reached.
- Showing limits for providers other than the one Hermes reports.

## Anti-goals

- Inventing numbers: unknown is never shown as 0; stale limits are never shown as current.
- Widening the MarketDesk → Hermes boundary (#464/#467): no OAuth token, no new key, no call to the
  Codex usage API from MarketDesk, no slash commands through chat.
- An AI call failing because recording failed.

## Approaches

1. **One capture seam in the completion client + attribution scope + host timer file for limits
   (chosen).** Every Hermes call passes one place; callers keep their signatures; limits need no new
   permission.
2. Return usage from every `IAIProvider` method. Rejected: changes the domain port and ~10 call sites
   and leaks transport detail into the domain.
3. Read limits by calling the Codex usage API from MarketDesk, or via `/usage` through chat. Rejected:
   needs the owner's OAuth token in MarketDesk, or sends a status read through an inference path next
   to the mutating `/usage reset`.

## How (decided)

- **Capture**: `HermesCompletionClient` parses `usage` defensively (non-negative integers, else NULL),
  measures latency, and hands one record per exit path (ok, non-2xx, timeout/transport, invalid body)
  to a sink. `complete()` keeps returning the text.
- **Attribution**: an AsyncLocalStorage scope `{ workspaceId, feature, productId? }` (modelled on
  `application/runs/runContext.ts`) wraps the call sites: `improve.seo`, `improve.price`,
  `draft.title`, `draft.analysis`, `autopilot.*`. The same scope collects the records of one graph
  invocation so the response can carry `aiUsage` totals. A call without a scope is still logged, and a
  `warn` names it as unattributed instead of silently dropping it.
- **Offline**: when `AIProviderSelector` resolves to offline for an attributed feature, one record
  with provider `offline`, NULL tokens, outcome `ok`.
- **Persistence**: migration `045_ai_usage.sql` (replay-safe `CREATE … IF NOT EXISTS`, no DROP),
  indexed by `(workspace_id, created_at DESC)`. Writes are fire-and-forget with a `warn` on failure.
  `cost_status` column: `included` (env `HERMES_BILLING_MODE=subscription_included`),
  `not_applicable` (offline), `unknown` (unset).
- **API** (workspace-scoped, existing auth): `GET /api/hermes/usage` (today, last 7 days, by feature)
  and `GET /api/hermes/limits` (`state: fresh | stale | unknown | not_configured`, plan, windows,
  fetchedAt, ageSeconds, reason). Limits file path from env `HERMES_USAGE_FILE`; unset →
  `not_configured`. Lines in `details` that mention `/usage reset` are dropped.
- **Ops (production, done by the agent during deploy)**: systemd user timer on hetzner every 5 min
  writing `~/projects/marketdesk-deploy/hermes-usage/usage.json` via temp file + rename; on failure
  write `{ "unavailable_reason": "fetch failed", "fetched_at": <now> }`. Compose override mounts
  `./hermes-usage:/app/hermes-usage:ro`; `.env` gets `HERMES_USAGE_FILE` and `HERMES_BILLING_MODE`.

## Testing

Owner rule: live q4j tests in `test-automation`, no new Jest mock tests. On the branch Compose stack
(no Hermes, offline AI; a fixture limits file mounted read-only):
- API: `/api/hermes/limits` returns `fresh` for a fresh fixture, `stale` for an old one, `unknown` for
  a broken one, `not_configured` when unset (separate stack config or an env toggle — builder's call);
  `/api/hermes/usage` counts an offline analysis after `POST /api/products/:id/improvements`;
  401 without login; another workspace's usage is not visible.
- UI: Hermes Activity shows the limits card with the fixture's plan and percent, and the usage card
  with the offline analysis; the product page shows "Offline heuristics · no AI usage" after an
  analysis.
- Hermes token parsing is checked on production with a real analysis (the stack has no Hermes).

## Settled after the builder check

- **Not streamed** (answered): `HermesCompletionClient` sends `stream: false`, so `usage` arrives in
  the single JSON body; on timeouts and non-2xx there is no usage and tokens stay NULL.
- **One analysis = one invocation** (agent's call): every graph invocation (one improvement run, one
  draft, one autopilot decision) gets an `analysis_id` (UUID) in the attribution scope and on every
  row. "Analyses" in the usage card count distinct `analysis_id`; tokens sum over rows. An
  improvement makes two calls (SEO + price) but counts as one analysis.
- **Autopilot attribution** (agent's call): the scope is opened inside `HermesDecisionEngine` at its
  three LLM entry points, from the workspace and product it already receives, so it does not depend on
  where the engine runs (request or job worker).
- **Per-analysis line only right after a run** (agent's call): improvement and draft results are not
  stored today, so the line is shown with the fresh result and not for past analyses; history lives
  in the usage card. No analysis table is added.
- **"Today" and day buckets** (agent's call): computed in the user's preference timezone
  (`UserPreferences.timezone`), UTC when unset.
- **Staleness** (agent's call): defined by `fetched_at` inside the limits file (Hermes's own
  timestamp), not file mtime; stale after 15 minutes, matching Hermes's own snapshot policy.
- **Migration number** (answered): `044_user_token_version.sql` is the latest on main, so this is
  `045_ai_usage.sql`; table and indexes use `IF NOT EXISTS`.

## Left to the builder

Exact card layout within the existing page style, the `feature` naming of autopilot calls, how the
limits fixture is switched between states on the stack, and whether the 7-day view is a small chart or
a table.
