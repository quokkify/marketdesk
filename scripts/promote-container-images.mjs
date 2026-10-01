import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const images = ['backend', 'frontend', 'assets'];
const repository = 'ghcr.io/quokkify/marketdesk';

export async function promoteImages(sha, run = execFileAsync) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Expected a full 40-character commit SHA');
  try {
    for (const image of images) {
      const tag = `${repository}-${image}:main`;
      const source = `${repository}-${image}:sha-${sha.slice(0, 12)}`;
      await run('docker', ['buildx', 'imagetools', 'create', '--tag', tag, source]);
    }
  } catch (promotionError) {
    // A failed update cannot safely delete a newly-created GHCR alias: the
    // registry's version-delete API can also delete the immutable SHA tag
    // when both tags address the same manifest. Instead, reconcile the full
    // alias set to this run's already-published immutable sources.
    const reconciliationErrors = [];
    for (const image of images) {
      const tag = `${repository}-${image}:main`;
      const source = `${repository}-${image}:sha-${sha.slice(0, 12)}`;
      try {
        await run('docker', ['buildx', 'imagetools', 'create', '--tag', tag, source]);
      } catch (error) {
        reconciliationErrors.push(`${tag}: ${error.message}`);
      }
    }
    if (reconciliationErrors.length) {
      throw new Error(`Promotion failed (${promotionError.message}); complete-set reconciliation failed: ${reconciliationErrors.join('; ')}`, { cause: promotionError });
    }
    throw new Error(`Promotion failed; all :main aliases reconciled to ${sha.slice(0, 12)}: ${promotionError.message}`, { cause: promotionError });
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  promoteImages(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
