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
  const warnings = [];
  // New lines follow the file's own line ending, so a CRLF file does not end up with both.
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n';
  // Edits never change the number of lines, so a line number found in `result` is the file's.
  const lineOf = (match) => result.slice(0, match.index).split('\n').length;

  for (const key of SECRET_KEYS) {
    // Same line grammar as dotenv and Compose: optional indentation and `export`, blanks around
    // the separator, and `:` as well as `=`. The last definition wins, so it decides.
    const definition = new RegExp(
      `^(${BLANK}*(?:export${BLANK}+)?${key})(${BLANK}*)([=:])([^\\r\\n]*)`,
      'gm',
    );
    const definitions = [...result.matchAll(definition)];
    const last = definitions.at(-1);
    if (last && !needsSecret(effectiveValue(last[4]))) continue;

    // A real value earlier in the file is the one the user chose. A generated secret after it
    // would override it, and a different MARKETPLACE_CREDENTIALS_KEY makes stored credentials
    // unreadable. dotenv and Compose do not even agree which spellings are a definition, so a
    // rewrite could turn a line dotenv ignores into one that wins. Leave both lines and name them.
    const real = definitions.findLast((match) => !needsSecret(effectiveValue(match[4])));
    if (real) {
      warnings.push(
        `${key} was left as it is: line ${lineOf(real)} sets it and line ${lineOf(last)} defines it ` +
          'again without a real value. Delete the line you do not want, then run this again.',
      );
      continue;
    }

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

  return { text: result, generated, warnings };
}

// `warn` gets one message for each key left alone because an earlier line already sets it. The CLI
// turns that into exit code 1.
export function initEnv({ cwd = process.cwd(), log = console.log, warn = console.warn } = {}) {
  const examplePath = resolve(cwd, '.env.example');
  const envPath = resolve(cwd, '.env');
  const created = !existsSync(envPath);

  if (created && !existsSync(examplePath)) {
    throw new Error('.env.example not found. Run this from the repository root.');
  }

  const { text, generated, warnings } = fillSecrets(
    readFileSync(created ? examplePath : envPath, 'utf8'),
  );

  if (created) {
    writeFileSync(envPath, text, { mode: 0o600, flag: 'wx' });
    log('Created .env from .env.example');
  } else if (generated.length > 0) {
    // Tighten first, so the new secrets never sit in a file that others can read.
    chmodSync(envPath, 0o600);
    writeFileSync(envPath, text);
  }

  for (const warning of warnings) warn(warning);
  if (generated.length > 0) log(`Generated ${generated.join(', ')}`);
  else if (warnings.length > 0) log('Generated nothing: fix the lines named above, then run this again');
  else log('.env already has every secret set; nothing to do');
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
    // A key left alone means the .env is still not usable, so exit 1: `npm run env:init &&
    // docker compose up` must stop there until the repeated line is fixed.
    let skipped = 0;
    initEnv({
      warn: (message) => {
        skipped += 1;
        console.warn(message);
      },
    });
    if (skipped > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
