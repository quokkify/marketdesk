import assert from 'node:assert/strict';
import { promoteImages } from './promote-container-images.mjs';

const images = ['backend', 'frontend', 'assets'];
const repository = 'ghcr.io/quokkify/marketdesk';
const sha = 'a'.repeat(40);
const incoming = images.map((image) => `${repository}-${image}:sha-${sha.slice(0, 12)}`);
const digest = (n) => `sha256:${String(n).repeat(64)}`;

for (const missingImages of [[], ['backend'], images]) {
  for (let failedPosition = 0; failedPosition < images.length; failedPosition += 1) {
    const tags = new Map();
    for (const [index, image] of images.entries()) {
      tags.set(incoming[index], digest(index + 4));
      if (!missingImages.includes(image)) tags.set(`${repository}-${image}:main`, digest(index + 1));
    }
    const calls = [];
    let promotionCount = 0;
    let injected = false;
    const fakeRun = async (command, args) => {
      calls.push([command, ...args]);
      const operation = args[2];
      if (operation !== 'create') throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
      const target = args[4];
      const source = args[5];
      assert.ok(tags.has(source), `source exists: ${source}`);
      if (source.includes(':sha-')) {
        promotionCount += 1;
        if (!injected && promotionCount === failedPosition + 1) {
          injected = true;
          throw new Error(`injected promotion failure at ${failedPosition}`);
        }
      }
      tags.set(target, tags.get(source));
      return { stdout: '' };
    };

    await assert.rejects(promoteImages(sha, fakeRun), /all :main aliases reconciled/);
    for (const [index, image] of images.entries()) {
      assert.equal(tags.get(`${repository}-${image}:main`), digest(index + 4), `${image} main is coherent after failure`);
      assert.equal(tags.get(incoming[index]), digest(index + 4), `${image} SHA tag remains intact`);
    }
    assert.equal(calls.some(([command]) => command === 'gh'), false, 'rollback must never delete GHCR package versions');
  }
}

let failureSeen = false;
const successfulSources = images.map((image) => `${repository}-${image}:sha-${'b'.repeat(12)}`);
const successfulTags = new Map(successfulSources.map((tag, index) => [tag, digest(index + 7)]));
await promoteImages('b'.repeat(40), async (_command, args) => {
  if (args[2] === 'create') successfulTags.set(args[4], successfulTags.get(args[5]));
  return { stdout: '' };
});
assert.deepEqual(images.map((image) => successfulTags.get(`${repository}-${image}:main`)), images.map((_, index) => digest(index + 7)));

await assert.rejects(
  promoteImages(sha, async (_command, args) => {
    if (args[2] === 'create' && args[5].includes(':sha-') && !failureSeen) {
      failureSeen = true;
      throw new Error('injected initial promotion failure');
    }
    if (args[2] === 'create' && args[5].includes(':sha-')) throw new Error('injected reconciliation failure');
    return { stdout: '' };
  }),
  /complete-set reconciliation failed/,
);

console.log('Promotion reconciliation verified for existing, mixed-missing, and first-publication aliases; immutable SHA tags survive failures at every promotion position.');
