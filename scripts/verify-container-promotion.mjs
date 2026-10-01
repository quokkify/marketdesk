import assert from 'node:assert/strict';
import { promoteImages } from './promote-container-images.mjs';

const images = ['backend', 'frontend', 'assets'];
const repository = 'ghcr.io/quokkify/marketdesk';
const sha = 'a'.repeat(40);
const digest = (n) => `sha256:${String(n).repeat(64)}`;

for (let failedPosition = 0; failedPosition < images.length; failedPosition += 1) {
  const calls = [];
  const state = new Map(images.map((image, index) => [`${repository}-${image}:main`, digest(index + 1)]));
  let promotionCount = 0;
  const fakeRun = async (_command, args) => {
    calls.push([...args]);
    const [,, operation, target, ...rest] = args;
    if (operation === 'inspect') return { stdout: `${state.get(target)}\n` };
    if (operation === 'create') {
      const tag = rest[0];
      const source = rest[1];
      if (source.includes(':sha-')) {
        promotionCount += 1;
        if (promotionCount === failedPosition + 1) throw new Error(`injected failure ${failedPosition}`);
      }
      state.set(tag, source.split('@').at(-1) ?? `promoted-${promotionCount}`);
      return { stdout: '' };
    }
    throw new Error(`unexpected docker operation: ${args.join(' ')}`);
  };

  await assert.rejects(promoteImages(sha, fakeRun), /all prior :main aliases restored/);
  assert.deepEqual(images.map((image) => state.get(`${repository}-${image}:main`)), images.map((_, index) => digest(index + 1)));
  const restores = calls.filter((args) => args[2] === 'create' && args[5]?.includes('@sha256:'));
  assert.equal(restores.length, images.length);
  for (const [index, args] of restores.entries()) {
    assert.deepEqual(args, ['buildx', 'imagetools', 'create', '--tag', `${repository}-${images[index]}:main`, `${repository}-${images[index]}@${digest(index + 1)}`]);
  }
}

for (let failedPosition = 0; failedPosition < images.length; failedPosition += 1) {
  const missingImage = images[0];
  const mainTags = new Set(images.filter((image) => image !== missingImage).map((image) => `${repository}-${image}:main`));
  const calls = [];
  let promotionCount = 0;
  const fakeRun = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'docker' && args[2] === 'inspect') {
      const tag = args[3];
      if (!mainTags.has(tag)) {
        const error = new Error('manifest unknown');
        error.stderr = 'manifest unknown';
        throw error;
      }
      return { stdout: `${digest(images.findIndex((image) => tag === `${repository}-${image}:main`) + 1)}\n` };
    }
    if (command === 'docker' && args[2] === 'create') {
      const tag = args[4];
      const source = args[5];
      if (source.includes(':sha-')) {
        promotionCount += 1;
        if (promotionCount === failedPosition + 1) throw new Error('injected promotion failure');
      }
      mainTags.add(tag);
      return { stdout: '' };
    }
    if (command === 'gh' && args[0] === 'api' && args.includes('--paginate')) return { stdout: mainTags.has(`${repository}-${missingImage}:main`) ? '123\n' : '' };
    if (command === 'gh' && args[0] === 'api' && args.includes('--method')) {
      assert.ok(args.at(-1).endsWith('/versions/123'));
      mainTags.delete(`${repository}-${missingImage}:main`);
      return { stdout: '' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };

  await assert.rejects(promoteImages(sha, fakeRun), /all prior :main aliases restored/);
  assert.equal(mainTags.has(`${repository}-${missingImage}:main`), false, 'new alias is deleted on rollback');
  assert.equal(mainTags.size, 2, 'pre-existing aliases remain present after rollback');
  assert.equal(calls.some(([command, ...args]) => command === 'gh' && args.includes('--method') && args.at(-1).endsWith('/versions/123')), failedPosition > 0, 'delete only an alias actually created before failure');
}

const bootstrapTags = new Set();
await promoteImages('b'.repeat(40), async (command, args) => {
  if (command === 'docker' && args[2] === 'inspect') {
    const error = new Error('manifest unknown');
    error.stderr = 'manifest unknown';
    throw error;
  }
  if (command === 'docker' && args[2] === 'create') bootstrapTags.add(args[4]);
  return { stdout: '' };
});
assert.deepEqual([...bootstrapTags].sort(), images.map((image) => `${repository}-${image}:main`).sort(), 'first publication creates the complete alias set');

let failedPromotion = false;
await assert.rejects(
  promoteImages(sha, async (_command, args) => {
    if (args[2] === 'inspect') return { stdout: `${digest(1)}\n` };
    if (args[2] === 'create' && args[5].includes(':sha-') && !failedPromotion) {
      failedPromotion = true;
      throw new Error('injected promotion failure');
    }
    if (args[2] === 'create' && args[5].includes('@sha256:')) throw new Error('injected rollback failure');
    return { stdout: '' };
  }),
  /rollback incomplete/,
);

console.log('Promotion rollback verified at all three failure positions; missing-alias bootstrap and cleanup verified.');
