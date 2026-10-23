#!/usr/bin/env node
// Bootstraps a local .env: copies .env.example when .env is absent, then generates the secrets
// the backend refuses to start without. A value that is already set is never overwritten,
// so running it again is safe.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'HERMES_WEBHOOK_SECRET',
  'MARKETPLACE_CREDENTIALS_KEY',
];

const PLACEHOLDER_PREFIX = 'your_';

function generateSecret() {
  return randomBytes(32).toString('base64');
}

// The value dotenv and Compose read, as far as "is it set" is concerned: quotes removed, and a
// value that is only an inline comment counts as empty.
function effectiveValue(raw) {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  return value.startsWith('#') ? '' : value;
}

function needsSecret(value) {
  return value === '' || value.startsWith(PLACEHOLDER_PREFIX);
}

function fillSecrets(text) {
  let result = text;
  const generated = [];

  for (const key of SECRET_KEYS) {
    // Same line grammar as dotenv and Compose: optional indentation and `export`, spaces around
    // the separator, and `:` as well as `=`. The last definition wins, so it decides.
    const definition = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${key}[ \\t]*[=:])([^\\r\\n]*)`, 'gm');
    const last = [...result.matchAll(definition)].at(-1);
    if (last && !needsSecret(effectiveValue(last[2]))) continue;

    const secret = generateSecret();
    if (last) {
      // Replace the value in place and keep the line's own prefix. dotenv ignores `KEY:value`
      // without a space, so a colon keeps one.
      const gap = last[1].endsWith(':') ? ' ' : '';
      result =
        result.slice(0, last.index) + last[1] + gap + secret + result.slice(last.index + last[0].length);
    } else {
      result += `${result === '' || result.endsWith('\n') ? '' : '\n'}${key}=${secret}\n`;
    }
    generated.push(key);
  }

  return { text: result, generated };
}

export function initEnv({ cwd = process.cwd(), log = console.log } = {}) {
  const examplePath = resolve(cwd, '.env.example');
  const envPath = resolve(cwd, '.env');
  const created = !existsSync(envPath);

  if (created && !existsSync(examplePath)) {
    throw new Error('.env.example not found. Run this from the repository root.');
  }

  const { text, generated } = fillSecrets(readFileSync(created ? examplePath : envPath, 'utf8'));

  if (created) {
    writeFileSync(envPath, text, { mode: 0o600, flag: 'wx' });
    log('Created .env from .env.example');
  } else if (generated.length > 0) {
    writeFileSync(envPath, text);
  }

  log(
    generated.length > 0
      ? `Generated ${generated.join(', ')}`
      : '.env already has every secret set; nothing to do',
  );
  return { created, generated };
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  try {
    initEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
