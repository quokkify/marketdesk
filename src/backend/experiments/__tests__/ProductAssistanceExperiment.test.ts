import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyExperimentError, runAssistanceExperiment } from '../ProductAssistanceExperiment';
import { sha256, writeAssistanceExperiment } from '../ExperimentBundle';
import { ProductAssistanceGraph } from '../../application/services/ProductAssistanceGraph';

// Tests run real graph nodes, output validators and domain entities.
describe('offline assistance experiments', () => {
  it('passes every versioned case and captures actual node failures before any later calls', async () => {
    const results = await runAssistanceExperiment();
    expect(results).toHaveLength(10);
    expect(results.filter((result) => !result.passed)).toEqual([]);
    const crossWorkspace = results.find((result) => result.caseId === 'foreign-workspace')!;
    expect(crossWorkspace.toolCalls).toEqual([]);
    expect(crossWorkspace.transitions).toEqual([
      { node: 'route', phase: 'started' },
      { node: 'route', phase: 'completed' },
      { node: 'improve', phase: 'started' },
      { node: 'improve', phase: 'failed' },
    ]);
    const invalid = results.find((result) => result.caseId === 'tool-command-in-output')!;
    expect(invalid.error).toBe('INVALID_OUTPUT');
    expect(invalid.output).toBeUndefined();
    expect(invalid.toolCalls.map((call) => call.tool)).toEqual(['analyzeListingSeo']);
  });

  it('replays identical outcomes and outputs independently of timing', async () => {
    const stable = (results: Awaited<ReturnType<typeof runAssistanceExperiment>>) =>
      results.map(({ latencyMs: _latency, ...result }) => result);
    expect(stable(await runAssistanceExperiment())).toEqual(
      stable(await runAssistanceExperiment())
    );
  });

  it('never exports arbitrary error text, stacks or names', () => {
    const error = new Error('Bearer secret buyer@example.test');
    error.name = 'Cookie: secret';
    expect(classifyExperimentError(error)).toBe('EXECUTION_FAILED');
    expect(classifyExperimentError({ token: 'secret' })).toBe('EXECUTION_FAILED');
  });

  it('exports a complete immutable bundle with verified checksums and an unapproved decision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistance-experiment-'));
    try {
      const provenance = {
        commit: 'a'.repeat(40),
        dirty: true,
        sourceSha256: { 'fixture.ts': 'b'.repeat(64) },
        nodeVersion: process.version,
      };
      const first = await writeAssistanceExperiment(directory, provenance);
      const second = await writeAssistanceExperiment(directory, provenance);
      expect(first.directory).not.toBe(second.directory);
      expect(first.gate).toBe('pass');
      expect(await readdir(directory)).toHaveLength(2);
      const manifest = JSON.parse(await readFile(join(first.directory, 'manifest.json'), 'utf8'));
      expect(manifest.provenance).toEqual(provenance);
      for (const [name, metadata] of Object.entries(manifest.files)) {
        const content = await readFile(join(first.directory, name), 'utf8');
        expect(sha256(content)).toBe((metadata as { sha256: string }).sha256);
        expect(content).not.toContain('DO-NOT-EXPORT');
      }
      const decision = JSON.parse(
        await readFile(
          join(first.directory, `decision/decision-${first.experimentId}.json`),
          'utf8'
        )
      );
      expect(decision).toMatchObject({
        status: 'pending-review',
        owner: null,
        approval: null,
        experiments: [first.experimentId],
        requiredChanges: [],
        newRegressionTests: [],
      });
      const evaluation = await readFile(join(first.directory, 'evaluation.json'), 'utf8');
      expect(decision.evidence.sha256).toBe(sha256(evaluation));
      expect(JSON.parse(evaluation)).toMatchObject({
        total: 10,
        passed: 10,
        failed: 0,
        gate: 'pass',
      });
      for (const file of [
        'inputs.jsonl',
        'state-transitions.jsonl',
        'tool-calls.jsonl',
        'outputs.jsonl',
        'errors.jsonl',
      ]) {
        const rows = (await readFile(join(first.directory, file), 'utf8')).trim().split('\n');
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(JSON.parse(row).caseId).toBeDefined();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains a failed run for analysis without approving a decision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assistance-failed-'));
    const failure = jest
      .spyOn(ProductAssistanceGraph.prototype, 'proposeImprovements')
      .mockRejectedValueOnce(new Error('Never export token=FAILURE-SECRET'));
    try {
      const run = await writeAssistanceExperiment(directory, {
        commit: 'a'.repeat(40),
        dirty: false,
        sourceSha256: { 'fixture.ts': 'b'.repeat(64) },
        nodeVersion: process.version,
      });
      expect(run.gate).toBe('fail');
      expect(run.passed).toBe(9);
      const evaluation = JSON.parse(await readFile(join(run.directory, 'evaluation.json'), 'utf8'));
      expect(evaluation.failed).toBe(1);
      const errors = await readFile(join(run.directory, 'errors.jsonl'), 'utf8');
      expect(errors).not.toContain('FAILURE-SECRET');
      const decision = JSON.parse(
        await readFile(join(run.directory, `decision/decision-${run.experimentId}.json`), 'utf8')
      );
      expect(decision.approval).toBeNull();
      expect(decision.evidence.gate).toBe('fail');
    } finally {
      failure.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing provenance before creating an artifact', async () => {
    await expect(
      writeAssistanceExperiment('/unused', {
        commit: 'unknown',
        dirty: false,
        sourceSha256: {},
        nodeVersion: process.version,
      })
    ).rejects.toThrow('source provenance');
  });
});
