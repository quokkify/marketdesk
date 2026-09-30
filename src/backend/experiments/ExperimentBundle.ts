import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { experimentRecipe, runAssistanceExperiment } from './ProductAssistanceExperiment';

export interface ExperimentProvenance {
  commit: string;
  dirty: boolean;
  sourceSha256: Record<string, string>;
  nodeVersion: string;
}

const limitations = [
  'Synthetic fixtures only; no buyer PII, production credentials, database or marketplace access.',
  'The real product-assistance graph runs with a deterministic provider; no model inference is evaluated.',
  'Injection cases test routing, output validation and absence of domain mutations, not real-model resistance or response quality.',
  'Only the improvement route is covered. Draft, publication, buyer conversations and durable checkpoints remain outside this dataset.',
  'Tool entries are injected provider method calls, not marketplace actions. No approval was granted or action applied.',
  'Timing measures local fixture execution, not production model latency.',
];

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function jsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : '');
}
export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

// This entry point cannot accept raw traces or external datasets: only built-in synthetic
// fixtures are exported. Real-data exports need a separate reviewed privacy boundary.
export async function writeAssistanceExperiment(
  outputRoot: string,
  provenance: ExperimentProvenance
) {
  if (
    !/^[a-f0-9]{40}$/.test(provenance.commit) ||
    Object.keys(provenance.sourceSha256).length === 0 ||
    Object.values(provenance.sourceSha256).some((hash) => !/^[a-f0-9]{64}$/.test(hash))
  ) {
    throw new Error('Valid source provenance is required');
  }
  const experimentId = randomUUID();
  const createdAt = new Date().toISOString();
  const results = await runAssistanceExperiment();
  const passed = results.filter((result) => result.passed).length;
  const evaluation = {
    schemaVersion: 1,
    experimentId,
    dataset: experimentRecipe.dataset,
    total: results.length,
    passed,
    failed: results.length - passed,
    gate: passed === results.length ? 'pass' : 'fail',
    metrics: {
      passRate: passed / results.length,
      domainMutationCount: results.filter((result) => !result.checks.domainUnchanged).length,
      providerCallViolations: results.filter((result) => !result.checks.providerCalls).length,
      reviewOnlyViolations: results.filter((result) => !result.checks.reviewOnly).length,
    },
    thresholds: {
      passRate: 1,
      domainMutationCount: 0,
      providerCallViolations: 0,
      reviewOnlyViolations: 0,
    },
    cases: results.map(({ caseId, expected, actual, passed, checks, latencyMs }) => ({
      caseId,
      expected,
      actual,
      passed,
      checks,
      latencyMs,
    })),
    limitations,
  };
  const decision = {
    schemaVersion: 1,
    id: experimentId,
    version: 1,
    createdAt,
    hypothesis:
      'The current assistance improvement graph preserves scoped, typed, review-only behavior for the versioned fixture dataset.',
    experiments: [experimentId],
    recipe: experimentRecipe.id,
    evidence: {
      path: '../evaluation.json',
      sha256: sha256(json(evaluation)),
      gate: evaluation.gate,
      passed,
      total: results.length,
    },
    limitations,
    status: 'pending-review',
    owner: null,
    approval: null,
    decision: 'No production behavior change authorized. Human analysis and approval are required.',
    rejectedAlternatives: ['Automatically promoting behavior from a passing fixture run.'],
    requiredChanges: [],
    newRegressionTests: [],
    nextStep:
      'Assign an owner; analyze failures and evidence; record proposed graph/prompt/policy/tool changes and regression cases in a reviewed new decision version.',
  };
  const files: Record<string, string> = {
    'recipe.json': json(experimentRecipe),
    'graph.md':
      '# Product assistance experiment\n\nActual LangGraph node lifecycle is recorded in state-transitions.jsonl. Full state is deliberately excluded.\n\n```text\nSTART -> route -> improve -> END\n```\n\nThe graph also supports draft and publication; this dataset exercises improve only.\n',
    'inputs.jsonl': jsonl(
      results.map(({ caseId, input, expected }) => ({ caseId, input, expected }))
    ),
    'state-transitions.jsonl': jsonl(
      results.flatMap(({ caseId, transitions }) =>
        transitions.map((transition, sequence) => ({ caseId, sequence, ...transition }))
      )
    ),
    'tool-calls.jsonl': jsonl(
      results.flatMap(({ caseId, toolCalls }) =>
        toolCalls.map((call, sequence) => ({ caseId, sequence, ...call }))
      )
    ),
    'outputs.jsonl': jsonl(
      results.map(({ caseId, actual, output }) => ({
        caseId,
        actual,
        ...(output ? { output } : {}),
      }))
    ),
    'errors.jsonl': jsonl(
      results.filter((result) => result.error).map(({ caseId, error }) => ({ caseId, code: error }))
    ),
    'evaluation.json': json(evaluation),
    'security-findings.md': `# Security findings\n\nFixture regression gate: **${evaluation.gate}**.\n\n${results.map((result) => `- ${result.caseId}: ${result.passed ? 'PASS' : 'FAIL'} (expected ${result.expected}; actual ${result.actual}).`).join('\n')}\n\n## Limits of this evidence\n\n${limitations.map((value) => `- ${value}`).join('\n')}\n`,
    'conclusion.md': `# Experiment ${experimentId}\n\n${passed}/${results.length} fixture cases passed. Gate: **${evaluation.gate}**.\n\nSource commit: ${provenance.commit}; dirty working tree: ${provenance.dirty}. Exact source hashes are in manifest.json.\n\nThis is offline evidence for review, not production approval. Read security-findings.md before drawing conclusions. The decision draft is in decision/.\n\nReplay with the recorded source, lockfile and Node version using npm ci followed by npm run experiment:assistance. IDs, timestamps and latency vary; expected outcomes and checks should match.\n`,
    [`decision/decision-${experimentId}.json`]: json(decision),
    [`decision/decision-${experimentId}.md`]: `# Decision draft ${experimentId} · v1\n\nStatus: pending-review. Owner: unassigned. Approval: none.\n\n## Hypothesis\n\n${decision.hypothesis}\n\n## Evidence\n\nExperiment: ${experimentId}. Recipe: ${experimentRecipe.id}. Gate: ${evaluation.gate}; ${passed}/${results.length} passed. See ../evaluation.json and ../security-findings.md.\n\n## Decision\n\n${decision.decision}\n\nRejected alternative: automatic promotion from fixture results.\n\n## Required analysis\n\n${decision.nextStep}\n\nNo graph changes or new regression cases have been approved by this draft. Keep the experiment immutable; create a new versioned decision for reviewed conclusions.\n`,
  };
  files['manifest.json'] = json({
    schemaVersion: 1,
    experimentId,
    createdAt,
    objective: decision.hypothesis,
    environment: 'local-offline-synthetic',
    provenance,
    recipe: experimentRecipe,
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, { sha256: sha256(content) }])
    ),
  });
  await mkdir(outputRoot, { recursive: true });
  const staging = join(outputRoot, `.${experimentId}.partial`);
  const destination = join(outputRoot, experimentId);
  await mkdir(staging);
  try {
    await mkdir(join(staging, 'decision'));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(staging, name), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    directory: destination,
    experimentId,
    gate: evaluation.gate,
    passed,
    total: results.length,
  };
}
