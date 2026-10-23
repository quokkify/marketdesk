import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { initEnv } from './init-env.mjs';

const scriptPath = fileURLToPath(new URL('./init-env.mjs', import.meta.url));
const SECRET_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'HERMES_WEBHOOK_SECRET',
  'MARKETPLACE_CREDENTIALS_KEY',
];

const ENV_EXAMPLE = [
  '# Application',
  'NODE_ENV=development',
  'DB_PASSWORD=marketdesk',
  '',
  '# JWT',
  'JWT_SECRET=your_jwt_secret_key_change_in_production',
  'JWT_REFRESH_SECRET=your_jwt_refresh_secret_key_change_in_production',
  '',
  'HERMES_API_KEY=your_local_hermes_api_server_key',
  'HERMES_WEBHOOK_SECRET=your_hermes_webhook_secret',
  'MARKETPLACE_CREDENTIALS_KEY=',
  'OLX_ADAPTER_MODE=stub',
  '',
].join('\n');

function withProject(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'marketdesk-init-env-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const quiet = () => {};
const readEnv = (dir) => readFileSync(join(dir, '.env'), 'utf8');
const decodedBytes = (value) => Buffer.from(value, 'base64').length;

test('creates .env from .env.example and fills every empty or placeholder secret', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    const result = initEnv({ cwd: dir, log: quiet });

    assert.deepEqual(result, { created: true, generated: SECRET_KEYS });
    const values = dotenv.parse(readEnv(dir));
    for (const key of SECRET_KEYS) {
      assert.equal(decodedBytes(values[key]), 32, `${key} must be a base64-encoded 32-byte value`);
    }
    assert.equal(new Set(SECRET_KEYS.map((key) => values[key])).size, SECRET_KEYS.length);
    assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600, '.env holds secrets');
  });
});

test('keeps every other line of .env.example exactly as written', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    initEnv({ cwd: dir, log: quiet });

    const withoutSecrets = (text) =>
      text.split('\n').filter((line) => !SECRET_KEYS.some((key) => line.startsWith(`${key}=`)));
    assert.deepEqual(withoutSecrets(readEnv(dir)), withoutSecrets(ENV_EXAMPLE));
    // Looks like a placeholder but belongs to the Hermes host, not to this script.
    assert.equal(dotenv.parse(readEnv(dir)).HERMES_API_KEY, 'your_local_hermes_api_server_key');
  });
});

test('is idempotent: a second run changes nothing and reports nothing', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    initEnv({ cwd: dir, log: quiet });
    const afterFirstRun = readEnv(dir);

    const second = initEnv({ cwd: dir, log: quiet });

    assert.deepEqual(second, { created: false, generated: [] });
    assert.equal(readEnv(dir), afterFirstRun);
  });
});

test('keeps an existing .env and fills only the secrets that are empty or missing', () => {
  const ownSecret = 'my-own-jwt-secret-that-is-long-enough-0123456789';
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': `JWT_SECRET=${ownSecret}\nOLX_ADAPTER_MODE=real\nMARKETPLACE_CREDENTIALS_KEY=\n`,
    },
    (dir) => {
      const result = initEnv({ cwd: dir, log: quiet });

      assert.deepEqual(result, {
        created: false,
        generated: ['JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET', 'MARKETPLACE_CREDENTIALS_KEY'],
      });
      const values = dotenv.parse(readEnv(dir));
      assert.equal(values.JWT_SECRET, ownSecret);
      assert.equal(values.OLX_ADAPTER_MODE, 'real');
      assert.equal(values.DB_PASSWORD, undefined, 'must not merge other keys from .env.example');
      assert.equal(decodedBytes(values.MARKETPLACE_CREDENTIALS_KEY), 32);
    },
  );
});

test('treats quoted placeholders and empty quotes as unset but keeps a quoted real value', () => {
  const realKey = Buffer.alloc(32, 5).toString('base64');
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': [
        'JWT_SECRET="your_jwt_secret_key_change_in_production"',
        "JWT_REFRESH_SECRET=''",
        'HERMES_WEBHOOK_SECRET=  # fill me in',
        `MARKETPLACE_CREDENTIALS_KEY="${realKey}"`,
        '',
      ].join('\n'),
    },
    (dir) => {
      const result = initEnv({ cwd: dir, log: quiet });

      assert.deepEqual(result.generated, ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET']);
      const values = dotenv.parse(readEnv(dir));
      assert.equal(values.MARKETPLACE_CREDENTIALS_KEY, realKey);
      for (const key of result.generated) assert.equal(decodedBytes(values[key]), 32);
    },
  );
});

test('judges a repeated key by its last definition, as dotenv does', () => {
  const realSecret = 'my-own-jwt-secret-that-is-long-enough-0123456789';
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': `JWT_SECRET=${realSecret}\nJWT_SECRET=your_jwt_secret_key_change_in_production\n`,
    },
    (dir) => {
      const result = initEnv({ cwd: dir, log: quiet });

      assert.ok(result.generated.includes('JWT_SECRET'));
      assert.equal(decodedBytes(dotenv.parse(readEnv(dir)).JWT_SECRET), 32);
    },
  );
});

test('does not count a commented-out secret as set', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': '# JWT_SECRET=commented-out-value-that-is-long-enough-0123456789\nNODE_ENV=development',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      const text = readEnv(dir);
      assert.match(text, /^# JWT_SECRET=commented-out-value/m);
      assert.equal(decodedBytes(dotenv.parse(text).JWT_SECRET), 32);
      assert.equal(dotenv.parse(text).NODE_ENV, 'development', 'a missing final newline must not merge lines');
    },
  );
});

test('CLI lists the keys it generated and never prints their values', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 0, run.stderr);
    for (const key of SECRET_KEYS) assert.match(run.stdout, new RegExp(key));
    const values = dotenv.parse(readEnv(dir));
    for (const key of SECRET_KEYS) {
      assert.ok(!run.stdout.includes(values[key]), `${key} value leaked to stdout`);
      assert.ok(!run.stderr.includes(values[key]), `${key} value leaked to stderr`);
    }
  });
});

test('CLI exits non-zero and points at .env.example when run outside the project root', () => {
  withProject({}, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /\.env\.example/);
  });
});
