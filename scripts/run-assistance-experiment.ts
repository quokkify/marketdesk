import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Disable automatic remote tracing before importing LangGraph. Do not load .env.
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGCHAIN_TRACING = 'false';
process.env.LANGSMITH_TRACING = 'false';
const { writeAssistanceExperiment, sha256 } =
  await import('../src/backend/experiments/ExperimentBundle');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  throw new Error('Usage: npm run experiment:assistance -- [--output directory]');
}
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
// Hash all runtime sources plus the runner and lockfile, including uncommitted edits.
const sources = git('ls-files', '--cached', '--others', '--exclude-standard')
  .split('\n')
  .filter(
    (path) =>
      path.startsWith('src/') ||
      path === 'package-lock.json' ||
      path === 'package.json' ||
      path === 'scripts/run-assistance-experiment.ts'
  );
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sources.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])
  )
);
const result = await writeAssistanceExperiment(
  resolve(args[1] ?? resolve(root, '.local/experiments')),
  {
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain').length > 0,
    sourceSha256,
    nodeVersion: process.version,
  }
);
console.log(JSON.stringify(result, null, 2));
if (result.gate !== 'pass') process.exitCode = 1;
