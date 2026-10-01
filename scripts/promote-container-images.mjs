import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const images = ['backend', 'frontend', 'assets'];
const repository = 'ghcr.io/quokkify/marketdesk';

export async function promoteImages(sha, run = execFileAsync) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Expected a full 40-character commit SHA');
  const tags = images.map((image) => `${repository}-${image}:main`);
  const previous = new Map();

  // Capture all previous aliases before mutating any of them. The immutable
  // digest references let the failure handler restore the original set.
  for (const tag of tags) {
    const { stdout } = await run('docker', ['buildx', 'imagetools', 'inspect', tag, '--format', '{{.Manifest.Digest}}']).catch((error) => {
      // A missing alias is expected during first publication; promotion can
      // bootstrap it, though there is no previous value to restore on failure.
      if (/not found|manifest unknown|no such manifest/i.test(error.stderr ?? error.message)) return { stdout: '' };
      throw error;
    });
    const digest = stdout.trim();
    if (!digest) continue;
    if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) throw new Error(`Could not resolve prior digest for ${tag}`);
    previous.set(tag, digest);
  }

  try {
    for (const image of images) {
      const tag = `${repository}-${image}:main`;
      const source = `${repository}-${image}:sha-${sha.slice(0, 12)}`;
      await run('docker', ['buildx', 'imagetools', 'create', '--tag', tag, source]);
    }
  } catch (promotionError) {
    const rollbackErrors = [];
    for (const [tag, digest] of previous) {
      try {
        const image = tag.slice(0, tag.lastIndexOf(':'));
        await run('docker', ['buildx', 'imagetools', 'create', '--tag', tag, `${image}@${digest}`]);
      } catch (error) {
        rollbackErrors.push(`${tag}: ${error.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`Promotion failed (${promotionError.message}); rollback incomplete: ${rollbackErrors.join('; ')}`, { cause: promotionError });
    }
    throw new Error(`Promotion failed; all prior :main aliases restored: ${promotionError.message}`, { cause: promotionError });
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  promoteImages(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
