#!/usr/bin/env node
// Bootstraps a local .env: copies .env.example when .env is absent, then generates every secret
// that is empty or a placeholder. The backend refuses to start without JWT_SECRET and
// MARKETPLACE_CREDENTIALS_KEY; the other two are filled so they never stay placeholders. A value
// that is already set is never overwritten, so running it again is safe.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'HERMES_WEBHOOK_SECRET',
  'MARKETPLACE_CREDENTIALS_KEY',
];

const PLACEHOLDER_PREFIX = 'your_';

// Any whitespace except a line break. dotenv and Compose read a byte order mark, a no-break space
// or a form feed like a space, so a class of spaces and tabs would miss a secret that is set.
const BLANK = '[^\\S\\r\\n]';

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
  // New lines follow the file's own line ending, so a CRLF file does not end up with both.
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n';

  for (const key of SECRET_KEYS) {
    // Same line grammar as dotenv and Compose: optional indentation and `export`, blanks around
    // the separator, and `:` as well as `=`. The last definition wins, so it decides.
    const definition = new RegExp(
      `^(${BLANK}*(?:export${BLANK}+)?${key})(${BLANK}*)([=:])([^\\r\\n]*)`,
      'gm',
    );
    const last = [...result.matchAll(definition)].at(-1);
    if (last && !needsSecret(effectiveValue(last[4]))) continue;

    const secret = generateSecret();
    if (last) {
      // Replace the value in place and keep the line's own prefix. dotenv reads `KEY: value` only
      // with the colon right after the key and a blank after it, so a colon gets exactly that.
      const [line, head, blank, separator] = last;
      const prefix = separator === ':' ? `${head}: ` : `${head}${blank}=`;
      result = result.slice(0, last.index) + prefix + secret + result.slice(last.index + line.length);
    } else {
      result += `${result === '' || result.endsWith('\n') ? '' : eol}${key}=${secret}${eol}`;
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
    // Tighten first, so the new secrets never sit in a file that others can read.
    chmodSync(envPath, 0o600);
    writeFileSync(envPath, text);
  }

  log(
    generated.length > 0
      ? `Generated ${generated.join(', ')}`
      : '.env already has every secret set; nothing to do',
  );
  return { created, generated };
}

// argv[1] is the path as typed and import.meta.url the real file, so compare real paths: a start
// through a symlink must not silently do nothing. argv[1] can also be no file (`node -e ... arg`).
const isEntrypoint =
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isEntrypoint) {
  try {
    initEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
