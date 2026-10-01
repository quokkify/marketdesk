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

const missingState = new Map();
const missingCalls = [];
await promoteImages('b'.repeat(40), async (_command, args) => {
  missingCalls.push([...args]);
  if (args[2] === 'inspect') {
    const error = new Error('manifest unknown');
    error.stderr = 'manifest unknown';
    throw error;
  }
  if (args[2] === 'create') missingState.set(args[4], args[5]);
  return { stdout: '' };
});
assert.equal(missingCalls.filter((args) => args[2] === 'create').length, 3, 'missing aliases bootstrap successfully');
assert.equal(missingState.size, 3);

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

console.log('Promotion rollback verified at all three failure positions; rollback arguments, alias restoration, and initial publication verified.');
