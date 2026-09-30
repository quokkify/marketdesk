import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Hash eligible working-tree sources, excluding tracked files deleted before staging. */
export async function collectExperimentSourceHashes(root: string): Promise<Record<string, string>> {
  const list = (...args: string[]) =>
    execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const deleted = new Set(list('--deleted'));
  const sources = list('--cached', '--others', '--exclude-standard').filter(
    (path) =>
      !deleted.has(path) &&
      (path.startsWith('src/') ||
        path === 'package-lock.json' ||
        path === 'package.json' ||
        path === 'scripts/run-assistance-experiment.ts')
  );
  return Object.fromEntries(
    await Promise.all(
      sources.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(resolve(root, path)))
          .digest('hex'),
      ])
    )
  );
}
