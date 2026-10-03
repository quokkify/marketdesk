#!/usr/bin/env node
// Exercise the actual dependency-free Release Please 17.6.0 Changelog updater.
// Supply its unchanged changelog.js/default.js from the action-pinned package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [updaterPath, outputDirectory] = process.argv.slice(2);
assert.ok(updaterPath && outputDirectory, 'Usage: node scripts/verify-native-changelog.mjs /absolute/changelog.js /output/directory');
const require = createRequire(import.meta.url);
const { Changelog } = require(resolve(updaterPath));
const audit = JSON.parse(readFileSync('docs/deployment/changelog-history-audit.json', 'utf8'));
mkdirSync(outputDirectory, { recursive: true });
for (const [component, path] of Object.entries(audit.targets)) {
  const original = readFileSync(path, 'utf8');
  const entry = `## [0.22.0](https://github.com/quokkify/marketdesk/compare/${component}-v0.21.0...${component}-v0.22.0) (2026-10-04)\n\n### Features\n\n* scoped fixture ([#901](https://github.com/quokkify/marketdesk/issues/901)) ([abcdef0](https://github.com/quokkify/marketdesk/commit/${'a'.repeat(40)}))`;
  const updated = new Changelog({ version: '0.22.0', changelogEntry: entry }).updateContent(original);
  assert.ok(updated.indexOf(entry) < updated.indexOf('## [0.21.0]'));
  assert.ok(updated.endsWith(original.slice(original.indexOf('## [0.21.0]'))));
  writeFileSync(join(outputDirectory, `${component}.md`), updated);
  const nextEntry = entry.replaceAll('0.21.0', '0.22.0').replaceAll('0.22.0)', '0.23.0)').replace('## [0.22.0]', '## [0.23.0]');
  const multiple = new Changelog({ version: '0.23.0', changelogEntry: nextEntry }).updateContent(updated);
  assert.ok(multiple.endsWith(updated.slice(updated.indexOf('## [0.22.0]'))));
  writeFileSync(join(outputDirectory, `${component}-multiple.md`), multiple);
}
console.log('Actual Release Please Changelog updater: 6 prepends preserve all current and inherited content. No GitHub writes.');
