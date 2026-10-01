import assert from 'node:assert/strict';
import { promoteImages } from './promote-container-images.mjs';

const images = ['backend', 'frontend', 'assets'];
const digest = (n) => `sha256:${String(n).repeat(64)}`;
const inspectResult = (n) => ({ stdout: `${digest(n)}\n` });

for (let failedPosition = 0; failedPosition < images.length; failedPosition += 1) {
  const calls = [];
  let promotionCount = 0;
  const fakeRun = async (_command, args) => {
    calls.push(args);
    if (args[2] === 'inspect') return inspectResult(images.indexOf(args[3].split('-').at(-1).split(':')[0]) + 1);
    if (args[2] === 'create' && args[5].includes(':sha-')) {
      promotionCount += 1;
      if (promotionCount === failedPosition + 1) throw new Error(`injected failure ${failedPosition}`);
    }
    return { stdout: '' };
  };

  await assert.rejects(promoteImages('a'.repeat(40), fakeRun), /all prior :main aliases restored/);
  const restored = calls.filter((args) => args[2] === 'create' && args[5]?.includes('@sha256:'));
  assert.equal(restored.length, images.length, `failure ${failedPosition}: restore all aliases`);
}

const successfulCalls = [];
await promoteImages('b'.repeat(40), async (_command, args) => {
  successfulCalls.push(args);
  if (args[2] === 'inspect') return { stdout: `${digest(1)}\n` };
  return { stdout: '' };
});
assert.equal(successfulCalls.filter((args) => args[2] === 'create' && args[5]?.includes(':sha-')).length, 3);
console.log('Promotion rollback verified for failures at all three positions and successful promotion.');
