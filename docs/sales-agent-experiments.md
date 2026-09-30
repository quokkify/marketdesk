# Sales agent experiments and decisions

Implementation slice of [#290](https://github.com/quokkify/marketdesk/issues/290), following the publication journey in #311. This implements a **local offline experiment lifecycle**, not the entire Sales Agent Platform. MarketDesk remains responsible for domain rules and external actions; LangGraph runs the existing assistance workflow. Hermes is unnecessary for these experiments: the provider port is supplied by deterministic fixtures.

## Run and export

```sh
npm ci
npm run experiment:assistance
# Optional export location, relative to the current directory:
npm run experiment:assistance -- --output ./exports
```

The default output is `.local/experiments/<experiment-id>/` (ignored by Git). Each run gets a new ID and writes its complete bundle through a staging directory; failures cannot leave an apparently complete bundle. The process exits nonzero if any regression gate fails, but still exports that run's evidence. No database, Redis, Hermes credentials or marketplace account are required. The command does not load `.env` and disables automatic LangChain/LangSmith remote tracing before importing the graph.

The runner only accepts an output directory. It cannot import customer data, arbitrary JSON traces or external model output. All product data, IDs and provider responses come from checked-in synthetic fixtures. Error messages/stacks are replaced by a fixed error code; node observers receive lifecycle events only. This is a data-minimization boundary, **not a general-purpose PII redactor**. A future real-provider or production-data runner needs a separately reviewed export policy.

```text
<experiment-id>/
  manifest.json
  recipe.json
  graph.md
  inputs.jsonl
  state-transitions.jsonl
  tool-calls.jsonl
  outputs.jsonl
  errors.jsonl
  evaluation.json
  security-findings.md
  conclusion.md
  decision/
    decision-<experiment-id>.json
    decision-<experiment-id>.md
```

The manifest records the application commit, dirty flag, source and lockfile SHA-256 hashes, Node version, graph/prompt/policy/tool/guardrail/dataset versions, fixture provider parameters and checksums of every other bundle file. Source hashes identify working-tree changes but cannot reconstruct them: commit the tested changes or retain the exact source checkout alongside the artifact. A clean committed run is the portable baseline. Replaying the same sources should reproduce outputs and gates; experiment IDs, timestamps and measured latency vary.

`state-transitions.jsonl` contains actual graph node lifecycle observations (started/completed/failed), correlated by case ID and sequence. It does not export full internal state or pretend to be a durable LangGraph checkpoint. `tool-calls.jsonl` records calls to the two injected provider methods and their review requirement. These are not external marketplace actions; no approval is granted. The recipe's prompt version identifies the associated catalog profile, but the fixture provider does not invoke a model or that prompt.

Copy the whole folder to another computer or upload its Markdown/JSONL/JSON files to NotebookLM or another reviewer. There are no localhost references or runtime dependencies in the exported material. Markdown gives human-readable conclusions; JSON and JSONL retain machine-readable evidence. Do not mix these bundles with `.env`, credential files or unrelated exports.

## Dataset and regression gate

`assistance-adversarial@1` executes the real `product-assistance@1` improvement route with real domain entities and injected read-only repositories/provider fixtures:

- Copy and price suggestions, and product-only suggestions without a price call.
- Foreign workspace, foreign listing, wrong product relation and foreign marketplace rejection before provider calls.
- Instruction-like text in product content, with no domain mutation or automatic application.
- An injected tool command in a provider response, rejected by the strict output schema.
- Negative suggested price rejection and provider failure propagation.

All ten cases must have the expected outcome and provider call count; successful outputs must remain review-only, and domain entities must remain unchanged. One failed case fails the gate. Tests verify repeatable outputs, actual failure traces, parseable artifacts, checksum integrity, error-text exclusion and absence of automatic approval.

This is a contract and routing regression suite. It **does not measure real-model prompt-injection resistance**, copy quality, pricing quality, sales conversion or production latency. Buyer conversations, the draft/publication branches, online feedback, canary rollout and durable checkpoints remain future work. Passing this suite alone cannot approve a rollout.

## Decision lifecycle

1. Run an experiment; retain its immutable bundle and matching source revision.
2. Analyze evidence and limitations locally or with an external reviewer.
3. Use the generated **pending-review draft** as the starting point for a new versioned decision. Assign an owner; record experiment IDs/checksums, hypothesis, evidence, rejected alternatives, concrete graph/prompt/policy/tool changes and new regression cases. Record approval explicitly after human review. Do not edit the original bundle in place.
4. Implement reviewed changes in a separate code revision and bump affected recipe/dataset versions.
5. Rerun regression cases and compare machine-readable outcomes before considering any later rollout.

The generated decision is scaffolding, not a fabricated analytical conclusion or approval. There is no code that imports decisions into production, modifies prompts, promotes recipes or performs live self-modification. Rollback of this experiment slice is simply reverting its code; no production schema or stored business state is changed.
