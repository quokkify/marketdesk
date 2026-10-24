import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

test('tightens an existing .env to owner-only when it writes secrets into it', () => {
  withProject({ '.env.example': ENV_EXAMPLE, '.env': 'NODE_ENV=development\n' }, (dir) => {
    chmodSync(join(dir, '.env'), 0o644);

    initEnv({ cwd: dir, log: quiet });

    assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600, '.env holds secrets now');
  });
});

// A CRLF file with appended LF lines mixes both endings, and editors then show the file as changed
// in places the script never touched.
for (const [name, eol] of [
  ['CRLF', '\r\n'],
  ['LF', '\n'],
]) {
  test(`writes every secret with the ${name} line ending the file already uses`, () => {
    withProject(
      {
        '.env.example': ENV_EXAMPLE,
        // No final newline: the first appended secret has to start its own line.
        '.env': ['NODE_ENV=development', 'JWT_SECRET=your_jwt_secret_key_change_in_production', 'OLX_ADAPTER_MODE=stub'].join(eol),
      },
      (dir) => {
        const result = initEnv({ cwd: dir, log: quiet });

        assert.deepEqual(result.generated, SECRET_KEYS);
        const text = readEnv(dir);
        const otherEol = eol === '\r\n' ? /(?<!\r)\n/ : /\r/;
        assert.doesNotMatch(text, otherEol, `every line break must be ${name}`);
        assert.equal(text.split(eol).length, 7, 'three original lines, three appended, one final break');
        assert.ok(text.startsWith(`NODE_ENV=development${eol}JWT_SECRET=`), 'the placeholder is replaced in place');
        assert.ok(text.includes(`${eol}OLX_ADAPTER_MODE=stub${eol}JWT_REFRESH_SECRET=`));
        const values = dotenv.parse(text);
        for (const key of SECRET_KEYS) assert.equal(decodedBytes(values[key]), 32);
      },
    );
  });
}

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

test('a placeholder before a real value does not make the key unset: the last definition decides', () => {
  const realSecret = 'my-own-jwt-secret-that-is-long-enough-0123456789';
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': `JWT_SECRET=your_jwt_secret_key_change_in_production\nJWT_SECRET=${realSecret}\n`,
    },
    (dir) => {
      const warnings = [];

      const result = initEnv({ cwd: dir, log: quiet, warn: (message) => warnings.push(message) });

      assert.ok(!result.generated.includes('JWT_SECRET'), 'the last definition is real, so the key is set');
      assert.equal(dotenv.parse(readEnv(dir)).JWT_SECRET, realSecret);
      assert.deepEqual(warnings, [], 'an overridden placeholder is not worth a warning');
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

test('leaves a longer key that shares the prefix and an indented "#export KEY=" comment untouched', () => {
  const original = [
    'JWT_SECRET_OLD=your_old_placeholder_the_script_must_not_touch',
    '  #export JWT_REFRESH_SECRET=commented-out-value-that-is-long-enough-0123456789',
    'NODE_ENV=development',
    '',
  ].join('\n');
  withProject({ '.env.example': ENV_EXAMPLE, '.env': original }, (dir) => {
    const result = initEnv({ cwd: dir, log: quiet });

    // Neither line defines a secret, so every secret is generated, as a new line after them.
    assert.deepEqual(result.generated, SECRET_KEYS);
    const text = readEnv(dir);
    assert.ok(text.startsWith(original), 'the original lines must survive byte for byte');
    const values = dotenv.parse(text);
    assert.equal(values.JWT_SECRET_OLD, 'your_old_placeholder_the_script_must_not_touch');
    for (const key of SECRET_KEYS) assert.equal(decodedBytes(values[key]), 32);
  });
});

// dotenv and Compose both accept these spellings of a definition. A real secret written
// this way must never be mistaken for a missing one: the appended line would win in both
// parsers, and replacing MARKETPLACE_CREDENTIALS_KEY makes stored credentials unreadable.
const CREDENTIALS_KEY = 'MARKETPLACE_CREDENTIALS_KEY';

function assertRealSecretKept(definition) {
  const realKey = Buffer.alloc(32, 5).toString('base64');
  withProject({ '.env.example': ENV_EXAMPLE, '.env': `${definition(realKey)}\n` }, (dir) => {
    const result = initEnv({ cwd: dir, log: quiet });

    assert.deepEqual(result.generated, ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET']);
    const text = readEnv(dir);
    assert.equal(dotenv.parse(text).MARKETPLACE_CREDENTIALS_KEY, realKey);
    assert.equal(
      text.split('\n').filter((line) => line.includes(CREDENTIALS_KEY)).length,
      1,
      'a second definition must not be appended',
    );
  });
}

test('keeps a real secret written as "export KEY=value"', () => {
  assertRealSecretKept((value) => `export ${CREDENTIALS_KEY}=${value}`);
});

test('keeps a real secret written with spaces around the equals sign', () => {
  assertRealSecretKept((value) => `${CREDENTIALS_KEY} = ${value}`);
});

test('keeps a real secret on an indented line', () => {
  assertRealSecretKept((value) => `  ${CREDENTIALS_KEY}=${value}`);
});

test('keeps a real secret written YAML-style as "KEY: value"', () => {
  assertRealSecretKept((value) => `${CREDENTIALS_KEY}: ${value}`);
});

// dotenv treats a byte order mark (Notepad adds one), a no-break space and a form feed as
// whitespace. A matcher that only knows spaces and tabs misses a secret written this way, appends
// a second definition, and that one wins.
for (const [name, definition] of [
  ['a leading byte order mark', (value) => `\uFEFF${CREDENTIALS_KEY}=${value}`],
  ['a leading no-break space', (value) => `\u00A0${CREDENTIALS_KEY}=${value}`],
  ['a leading form feed', (value) => `\f${CREDENTIALS_KEY}=${value}`],
  ['no-break spaces around the equals sign', (value) => `${CREDENTIALS_KEY}\u00A0=\u00A0${value}`],
  ['a no-break space after export', (value) => `export\u00A0${CREDENTIALS_KEY}=${value}`],
]) {
  test(`keeps a real secret written with ${name}`, () => {
    assertRealSecretKept(definition);
  });
}

test('replaces a placeholder behind a byte order mark in place and keeps the mark', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': '\uFEFFJWT_SECRET=your_jwt_secret_key_change_in_production\nNODE_ENV=development\n',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      const text = readEnv(dir);
      assert.ok(text.startsWith('\uFEFFJWT_SECRET='), 'the line is rewritten where it was');
      assert.equal(text.split('\n').filter((line) => line.includes('JWT_SECRET=')).length, 1);
      assert.equal(decodedBytes(dotenv.parse(text).JWT_SECRET), 32);
    },
  );
});

test('never rewrites a real secret written as "KEY : value", which Compose reads as set', () => {
  const realKey = Buffer.alloc(32, 5).toString('base64');
  const line = `${CREDENTIALS_KEY} : ${realKey}`;
  withProject({ '.env.example': ENV_EXAMPLE, '.env': `${line}\n` }, (dir) => {
    const result = initEnv({ cwd: dir, log: quiet });

    assert.deepEqual(result.generated, ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET']);
    assert.ok(readEnv(dir).startsWith(`${line}\n`), 'the line stays exactly as written');
  });
});

// A real value for a key, then the same key again without one. Replacing the later line would put a
// generated secret next to the real one, and a different MARKETPLACE_CREDENTIALS_KEY makes stored
// marketplace credentials unreadable. dotenv and Compose also disagree about which of these
// spellings they read at all (dotenv ignores a blank before the colon and a colon without a blank
// after it), so a rewrite can turn a line dotenv ignored into one that overrides the real value.
// The only safe move is to leave both lines alone and say which ones they are.
for (const [name, repeated] of [
  ['"KEY : your_..." (dotenv ignores it)', `${CREDENTIALS_KEY} : your_marketplace_credentials_key`],
  ['"KEY:your_..." (dotenv ignores it)', `${CREDENTIALS_KEY}:your_marketplace_credentials_key`],
  ['"KEY: your_..."', `${CREDENTIALS_KEY}: your_marketplace_credentials_key`],
  ['"KEY=your_..."', `${CREDENTIALS_KEY}=your_marketplace_credentials_key`],
  ['"export KEY=your_..."', `export ${CREDENTIALS_KEY}=your_marketplace_credentials_key`],
  ['an empty "KEY="', `${CREDENTIALS_KEY}=`],
]) {
  test(`leaves a real secret and a later ${name} untouched and warns about the repeated line`, () => {
    const realKey = Buffer.alloc(32, 5).toString('base64');
    const original = [`${CREDENTIALS_KEY}=${realKey}`, 'NODE_ENV=development', repeated, ''].join('\n');
    withProject({ '.env.example': ENV_EXAMPLE, '.env': original }, (dir) => {
      const warnings = [];

      const result = initEnv({ cwd: dir, log: quiet, warn: (message) => warnings.push(message) });

      assert.deepEqual(result.generated, ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET']);
      const text = readEnv(dir);
      assert.ok(text.startsWith(original), 'both lines stay exactly as written, other secrets come after');
      assert.equal(text.split('\n').filter((line) => line.includes(CREDENTIALS_KEY)).length, 2);
      assert.equal(
        dotenv.parse(text)[CREDENTIALS_KEY],
        dotenv.parse(original)[CREDENTIALS_KEY],
        'dotenv must read the same value as before the run',
      );
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], new RegExp(CREDENTIALS_KEY));
      assert.match(warnings[0], /\bline 1\b/);
      assert.match(warnings[0], /\bline 3\b/);
      assert.ok(!warnings[0].includes(realKey), 'a warning must not print a secret');
    });
  });
}

test('replaces an "export KEY=your_..." placeholder in place and keeps the export prefix', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': [
        'NODE_ENV=development',
        'export JWT_SECRET=your_jwt_secret_key_change_in_production',
        'OLX_ADAPTER_MODE=stub',
        '',
      ].join('\n'),
    },
    (dir) => {
      const result = initEnv({ cwd: dir, log: quiet });

      assert.ok(result.generated.includes('JWT_SECRET'));
      const lines = readEnv(dir).split('\n');
      assert.equal(lines[0], 'NODE_ENV=development');
      assert.match(lines[1], /^export JWT_SECRET=\S+$/);
      assert.equal(lines[2], 'OLX_ADAPTER_MODE=stub');
      assert.equal(lines.filter((line) => /^(export\s+)?JWT_SECRET\s*[=:]/.test(line)).length, 1);
      assert.equal(decodedBytes(dotenv.parse(readEnv(dir)).JWT_SECRET), 32);
      assert.deepEqual(initEnv({ cwd: dir, log: quiet }), { created: false, generated: [] });
    },
  );
});

test('replaces an indented placeholder with spaces around the equals sign in place', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': '  JWT_REFRESH_SECRET = your_jwt_refresh_secret_key_change_in_production\n',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      const text = readEnv(dir);
      assert.match(text.split('\n')[0], /^ {2}JWT_REFRESH_SECRET =\s*\S+$/);
      assert.equal(text.split('\n').filter((line) => line.includes('JWT_REFRESH_SECRET')).length, 1);
      assert.equal(decodedBytes(dotenv.parse(text).JWT_REFRESH_SECRET), 32);
    },
  );
});

test('replaces a YAML-style placeholder in place and keeps it readable by dotenv', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': 'HERMES_WEBHOOK_SECRET: your_hermes_webhook_secret\n',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      const text = readEnv(dir);
      const definitions = text.split('\n').filter((line) => line.includes('HERMES_WEBHOOK_SECRET'));
      assert.equal(definitions.length, 1, 'the placeholder line must be rewritten, not left behind');
      assert.match(definitions[0], /^HERMES_WEBHOOK_SECRET: \S+$/);
      assert.equal(decodedBytes(dotenv.parse(text).HERMES_WEBHOOK_SECRET), 32);
    },
  );
});

test('adds the space dotenv needs after a colon when it replaces "KEY:placeholder"', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': 'HERMES_WEBHOOK_SECRET:your_hermes_webhook_secret\n',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      // dotenv ignores "KEY:value" without a space, so the rewritten line must not be spelled that way.
      const text = readEnv(dir);
      const definitions = text.split('\n').filter((line) => line.includes('HERMES_WEBHOOK_SECRET'));
      assert.equal(definitions.length, 1, 'the placeholder line must be rewritten, not left behind');
      const value = dotenv.parse(text).HERMES_WEBHOOK_SECRET;
      assert.equal(typeof value, 'string', 'dotenv must be able to read the rewritten line');
      assert.equal(decodedBytes(value), 32);
    },
  );
});

test('drops the blank before the colon when it rewrites "KEY : placeholder", which dotenv cannot read', () => {
  withProject(
    {
      '.env.example': ENV_EXAMPLE,
      '.env': 'HERMES_WEBHOOK_SECRET : your_hermes_webhook_secret\n',
    },
    (dir) => {
      initEnv({ cwd: dir, log: quiet });

      const text = readEnv(dir);
      const definitions = text.split('\n').filter((line) => line.includes('HERMES_WEBHOOK_SECRET'));
      assert.equal(definitions.length, 1, 'the placeholder line must be rewritten, not left behind');
      assert.match(definitions[0], /^HERMES_WEBHOOK_SECRET: \S+$/);
      assert.equal(decodedBytes(dotenv.parse(text).HERMES_WEBHOOK_SECRET), 32);
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

// Regression guard: the entrypoint check compared the real module path with argv[1] as typed, so a
// script started through a symlink (a linked checkout, a shortcut) exited 0 and did nothing.
test('CLI still runs when it is started through a symlink', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    const link = join(dir, 'init-env-link.mjs');
    symlinkSync(scriptPath, link);

    const run = spawnSync(process.execPath, [link], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(dir, '.env')), 'a symlinked entrypoint must not silently do nothing');
    assert.match(run.stdout, /JWT_SECRET/);
  });
});

// A .env with a key that env:init cannot fix on its own must stop `npm run env:init && docker compose up`.
test('CLI warns on stderr about a repeated secret, exits 1 and does not say there was nothing to do', () => {
  const realKey = Buffer.alloc(32, 5).toString('base64');
  const own = Buffer.alloc(32, 8).toString('base64');
  const original = [
    `JWT_SECRET=${own}`,
    `JWT_REFRESH_SECRET=${own}`,
    `HERMES_WEBHOOK_SECRET=${own}`,
    `${CREDENTIALS_KEY}=${realKey}`,
    `${CREDENTIALS_KEY}=your_marketplace_credentials_key`,
    '',
  ].join('\n');
  withProject({ '.env.example': ENV_EXAMPLE, '.env': original }, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /MARKETPLACE_CREDENTIALS_KEY.*\bline 4\b.*\bline 5\b/);
    assert.match(run.stdout, /Generated nothing/);
    assert.doesNotMatch(run.stdout, /nothing to do/);
    assert.equal(readEnv(dir), original, 'nothing may be written');
    for (const value of [own, realKey]) {
      assert.ok(!run.stdout.includes(value) && !run.stderr.includes(value), 'a secret leaked');
    }
  });
});

test('CLI exits 1 for a skipped key even when it generated the other secrets, and keeps them', () => {
  const realKey = Buffer.alloc(32, 5).toString('base64');
  const original = [
    `${CREDENTIALS_KEY}=${realKey}`,
    `${CREDENTIALS_KEY}=your_marketplace_credentials_key`,
    '',
  ].join('\n');
  withProject({ '.env.example': ENV_EXAMPLE, '.env': original }, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /^Generated JWT_SECRET, JWT_REFRESH_SECRET, HERMES_WEBHOOK_SECRET$/m);
    assert.match(run.stderr, /MARKETPLACE_CREDENTIALS_KEY.*\bline 1\b.*\bline 2\b/);
    const text = readEnv(dir);
    assert.ok(text.startsWith(original), 'the repeated lines stay exactly as written');
    const values = dotenv.parse(text);
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HERMES_WEBHOOK_SECRET']) {
      assert.equal(decodedBytes(values[key]), 32, `${key} must still be generated`);
    }
  });
});

// Only a real value earlier in the file makes the script leave a key alone. A key whose every
// definition is a placeholder or empty has no value to keep, so it is filled like a missing one.
test('CLI fills a key whose every definition is a placeholder or empty, and exits 0', () => {
  const original = [
    `${CREDENTIALS_KEY}=your_marketplace_credentials_key`,
    'NODE_ENV=development',
    `${CREDENTIALS_KEY}=`,
    '',
  ].join('\n');
  withProject({ '.env.example': ENV_EXAMPLE, '.env': original }, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, new RegExp(CREDENTIALS_KEY), 'no real value, so no warning');
    assert.match(run.stdout, /^Generated .*MARKETPLACE_CREDENTIALS_KEY/m);
    assert.equal(decodedBytes(dotenv.parse(readEnv(dir))[CREDENTIALS_KEY]), 32);
  });
});

test('CLI exits 0 on a second clean run and changes nothing', () => {
  withProject({ '.env.example': ENV_EXAMPLE }, (dir) => {
    const first = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });
    const afterFirstRun = readEnv(dir);

    const second = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /nothing to do/);
    assert.equal(readEnv(dir), afterFirstRun);
  });
});

test('CLI exits non-zero and points at .env.example when run outside the project root', () => {
  withProject({}, (dir) => {
    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /\.env\.example/);
  });
});
