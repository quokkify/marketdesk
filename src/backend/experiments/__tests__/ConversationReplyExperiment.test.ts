import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConversationExperiment, writeConversationExperiment } from '../ConversationReplyExperiment';
import { sha256 } from '../ExperimentBundle';
import { conversationCases, conversationFixtureTexts } from '../fixtures/conversation-adversarial';

describe('conversation adversarial experiment', () => {
  it('gatePassesOnAllCases', async () => {
    const results = await runConversationExperiment();
    expect(results).toHaveLength(conversationCases.length);
    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(results.map((r) => r.actual.kind)).toEqual([
      'suspicious', 'suspicious', 'no_safe_draft', 'suspicious', 'no_safe_draft',
      'drafted', 'suspicious', 'error', 'no_safe_draft', 'drafted',
    ]);
    expect(results.find((r) => r.caseId === 'tool-call-shape')?.actual).toEqual({ kind: 'error', code: 'INVALID_OUTPUT' });
  });

  it('bundleContainsNoMessageText', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conversation-experiment-'));
    try {
      const provenance = {
        commit: 'a'.repeat(40), dirty: true, sourceSha256: { 'fixture.ts': 'b'.repeat(64) },
        nodeVersion: process.version,
      };
      const written = await writeConversationExperiment(directory, provenance);
      expect(written.gate).toBe('pass');
      expect(await readdir(directory)).toHaveLength(1);
      const manifest = JSON.parse(await readFile(join(written.directory, 'manifest.json'), 'utf8'));
      const names = Object.keys(manifest.files);
      expect(names).toEqual(expect.arrayContaining(['evaluation.json', 'outputs.jsonl', 'errors.jsonl']));
      const texts = conversationFixtureTexts();
      expect(texts.length).toBeGreaterThan(10);
      for (const name of [...names, 'manifest.json']) {
        const content = await readFile(join(written.directory, name), 'utf8');
        if (name !== 'manifest.json') expect(sha256(content)).toBe(manifest.files[name].sha256);
        for (const text of texts) expect(content).not.toContain(text);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
