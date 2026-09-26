import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectExperimentSourceHashes } from '../ExperimentSources';

it('hashes current eligible sources while skipping staged and unstaged deletions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'experiment-sources-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const put = (path: string, value = 'original') => writeFile(join(root, path), value);
  try {
    git('init');
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'scripts'));
    const tracked = [
      'src/deleted.ts',
      'src/staged-deletion.ts',
      'src/modified.ts',
      'src/unchanged.ts',
      'package.json',
      'package-lock.json',
      'scripts/run-assistance-experiment.ts',
      'scripts/unrelated.ts',
      'README.md',
    ];
    await Promise.all(tracked.map((path) => put(path)));
    await put('.gitignore', 'src/ignored.ts\n');
    git('add', '.');
    await rm(join(root, 'src/deleted.ts'));
    await rm(join(root, 'src/staged-deletion.ts'));
    git('add', '-u', 'src/staged-deletion.ts');
    await put('src/modified.ts', 'working-tree change');
    await put('src/untracked.ts');
    await put('src/name with\nnewline.ts');
    await put('src/ignored.ts');
    await put('unrelated.txt');

    const hashes = await collectExperimentSourceHashes(root);
    expect(Object.keys(hashes).sort()).toEqual(
      [
        'src/modified.ts',
        'src/unchanged.ts',
        'src/untracked.ts',
        'src/name with\nnewline.ts',
        'package.json',
        'package-lock.json',
        'scripts/run-assistance-experiment.ts',
      ].sort()
    );
    expect(hashes['src/modified.ts']).toBe(
      createHash('sha256').update('working-tree change').digest('hex')
    );
    expect(hashes['src/unchanged.ts']).toBe(createHash('sha256').update('original').digest('hex'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
