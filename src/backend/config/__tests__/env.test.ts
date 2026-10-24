// S1: the JWT secret resolver must fail closed in production (no usable secret, so nothing can
// be signed or verified) and return a clearly-marked dev-only value outside production.

import jwt from 'jsonwebtoken';
import { AesGcmCredentialVault } from '../../infrastructure/security/AesGcmCredentialVault';
import {
  assertStartupConfiguration,
  env,
  insecureDevJwtAllowed,
  positiveInt,
  resolveDatabaseSslMode,
  resolveJwtSecret,
} from '../env';

describe('resolveDatabaseSslMode', () => {
  it('allows production to explicitly disable TLS for internal Compose PostgreSQL', () => {
    expect(resolveDatabaseSslMode('disable', true)).toBe('disable');
  });

  it('enables verified TLS explicitly in production', () => {
    expect(resolveDatabaseSslMode('verify-full', true)).toBe('verify-full');
  });

  it.each([undefined, '', '   '])('rejects a missing production mode: %p', (value) => {
    expect(() => resolveDatabaseSslMode(value, true)).toThrow(/DB_SSL_MODE/);
  });

  it.each(['require', 'verify-ca', 'true', 'DISABLE'])(
    'rejects invalid mode %s',
    (value) => {
      expect(() => resolveDatabaseSslMode(value, true)).toThrow(/DB_SSL_MODE/);
    },
  );

  it('defaults to plaintext outside production for ergonomic local and test use', () => {
    expect(resolveDatabaseSslMode(undefined, false)).toBe('disable');
  });
});

describe('positiveInt', () => {
  it('returns a configured positive integer or the fallback', () => {
    expect(positiveInt('4096', 1024, 'MAX_FILE_SIZE')).toBe(4096);
    expect(positiveInt(undefined, 1024, 'MAX_FILE_SIZE')).toBe(1024);
  });

  it.each(['abc', '12abc', '0', '-1', '1.5', '9007199254740992'])(
    'rejects invalid configured value %s',
    (value) => {
      expect(() => positiveInt(value, 1024, 'MAX_FILE_SIZE')).toThrow(/positive integer/);
    },
  );
});

describe('resolveJwtSecret (S1 fail-closed JWT secret)', () => {
  describe('production', () => {
    const PROD = true;

    // A placeholder must not crash the import: assertStartupConfiguration reports it together
    // with every other startup problem. An empty secret signs and verifies nothing, so code that
    // never runs that gate still fails closed.
    it.each([
      ['unset', undefined],
      ['an empty string', ''],
      ['still a your_-prefixed placeholder', 'your_jwt_secret_key_change_in_production'],
    ])('resolves a secret that is %s to an empty secret', (_label, value) => {
      expect(resolveJwtSecret(value, 'JWT_SECRET', PROD)).toBe('');
    });

    it('leaves no secret that can sign or verify a token', () => {
      const secret = resolveJwtSecret(undefined, 'JWT_SECRET', PROD);
      const tokenFromElsewhere = jwt.sign({ userId: 'u-1' }, 'a-secret-the-app-never-had');

      expect(() => jwt.sign({ userId: 'u-1' }, secret)).toThrow();
      expect(() => jwt.verify(tokenFromElsewhere, secret, { algorithms: ['HS256'] })).toThrow();
    });

    it('returns a real, non-placeholder secret unchanged', () => {
      expect(
        resolveJwtSecret('a-strong-production-secret-value', 'JWT_SECRET', PROD),
      ).toBe('a-strong-production-secret-value');
    });
  });

  describe('development', () => {
    const DEV = false;

    it('returns a clearly-marked dev-only value when unset', () => {
      const secret = resolveJwtSecret(undefined, 'JWT_SECRET', DEV);
      expect(secret).toContain('dev-only-insecure');
    });

    it('does not fall back to a your_-prefixed placeholder', () => {
      const secret = resolveJwtSecret('your_placeholder', 'JWT_SECRET', DEV);
      expect(secret.startsWith('your_')).toBe(false);
      expect(secret).toContain('dev-only-insecure');
    });

    it('returns a real configured secret unchanged', () => {
      expect(resolveJwtSecret('my-dev-secret', 'JWT_SECRET', DEV)).toBe('my-dev-secret');
    });
  });
});

// Fail-fast boot: main.ts calls assertStartupConfiguration(env) before it touches any
// resource, so a fresh .env copied from .env.example must stop the process with an
// actionable message instead of serving a half-working API.
describe('assertStartupConfiguration (fail-fast boot)', () => {
  const strongJwtSecret = Buffer.alloc(32, 9).toString('base64');
  const validCredentialsKey = Buffer.alloc(32, 7).toString('base64');

  // A development-mode configuration that is valid; each test breaks exactly one thing. The
  // gate reads ALLOW_INSECURE_DEV_JWT from env, never from process.env.
  function config(
    overrides: {
      nodeEnv?: string;
      jwtSecret?: string;
      credentialsKey?: string;
      allowInsecureDevJwt?: boolean;
    } = {},
  ): typeof env {
    return {
      ...env,
      nodeEnv: overrides.nodeEnv ?? 'development',
      allowInsecureDevJwt: overrides.allowInsecureDevJwt ?? false,
      jwt: { ...env.jwt, secret: overrides.jwtSecret ?? strongJwtSecret },
      marketplaceCredentialsKey: overrides.credentialsKey ?? validCredentialsKey,
    };
  }

  it('accepts a strong JWT secret together with a base64 32-byte credentials key', () => {
    expect(() => assertStartupConfiguration(config())).not.toThrow();
  });

  it('rejects an empty MARKETPLACE_CREDENTIALS_KEY with the fix command', () => {
    expect(() => assertStartupConfiguration({ ...env, marketplaceCredentialsKey: '' })).toThrow(
      /MARKETPLACE_CREDENTIALS_KEY.*npm run env:init/,
    );
  });

  it('tells an empty credentials key apart from an invalid one', () => {
    const empty = () => assertStartupConfiguration(config({ credentialsKey: '' }));
    const invalid = () => assertStartupConfiguration(config({ credentialsKey: 'not-a-key' }));

    expect(empty).toThrow(/MARKETPLACE_CREDENTIALS_KEY is empty/);
    expect(invalid).toThrow(/MARKETPLACE_CREDENTIALS_KEY is not a base64-encoded 32-byte key/);
    expect(invalid).not.toThrow(/is empty/);
  });

  it.each([
    ['not base64 and far too short', 'not-a-key'],
    ['a 16-byte key', Buffer.alloc(16, 1).toString('base64')],
    ['a 33-byte key', Buffer.alloc(33, 1).toString('base64')],
  ])('rejects a credentials key that is %s', (_label, credentialsKey) => {
    expect(() => assertStartupConfiguration(config({ credentialsKey }))).toThrow(
      /MARKETPLACE_CREDENTIALS_KEY.*32-byte.*openssl rand -base64 32/,
    );
  });

  it('warns that replacing a credentials key makes stored marketplace credentials unreadable', () => {
    expect(() => assertStartupConfiguration(config({ credentialsKey: 'not-a-key' }))).toThrow(
      /MARKETPLACE_CREDENTIALS_KEY.*openssl rand -base64 32.*stored marketplace credentials.*unreadable/,
    );
  });

  it.each([
    ['empty', ''],
    ['the .env.example placeholder', 'your_jwt_secret_key_change_in_production'],
    [
      'the development fallback that resolveJwtSecret generates',
      resolveJwtSecret(undefined, 'JWT_SECRET', false),
    ],
    ['a dev-only fallback value, however long', `dev-only-insecure-${'x'.repeat(20)}`],
  ])('rejects a JWT_SECRET that is %s outside test mode', (_label, jwtSecret) => {
    const boot = () => assertStartupConfiguration(config({ jwtSecret }));

    expect(boot).toThrow(/JWT_SECRET is empty or still a placeholder/);
    expect(boot).toThrow(/JWT_SECRET.*npm run env:init/);
  });

  it('rejects a JWT_SECRET of 31 characters and says to replace it, because env:init keeps a set value', () => {
    const boot = () => assertStartupConfiguration(config({ jwtSecret: 'a'.repeat(31) }));

    expect(boot).toThrow(/JWT_SECRET is shorter than 32 characters.*openssl rand -base64 32/);
    expect(boot).not.toThrow(/JWT_SECRET is shorter[^\n]*npm run env:init/);
  });

  it('accepts a JWT_SECRET of exactly 32 characters', () => {
    expect(() => assertStartupConfiguration(config({ jwtSecret: 'a'.repeat(32) }))).not.toThrow();
  });

  it('accepts a placeholder JWT_SECRET only when ALLOW_INSECURE_DEV_JWT=true', () => {
    const placeholder = config({ jwtSecret: 'your_jwt_secret_key_change_in_production' });
    const relaxed = config({
      jwtSecret: 'your_jwt_secret_key_change_in_production',
      allowInsecureDevJwt: true,
    });

    expect(() => assertStartupConfiguration(placeholder)).toThrow(/JWT_SECRET/);
    expect(() => assertStartupConfiguration(relaxed)).not.toThrow();
  });

  it('treats test mode like ALLOW_INSECURE_DEV_JWT=true so Jest suites keep short secrets', () => {
    expect(() =>
      assertStartupConfiguration(config({ nodeEnv: 'test', jwtSecret: 'ci-short' })),
    ).not.toThrow();
  });

  it('ignores ALLOW_INSECURE_DEV_JWT in production', () => {
    expect(() =>
      assertStartupConfiguration(
        config({ nodeEnv: 'production', jwtSecret: 'a'.repeat(31), allowInsecureDevJwt: true }),
      ),
    ).toThrow(/JWT_SECRET/);
  });

  it('does not let ALLOW_INSECURE_DEV_JWT bypass the credentials key', () => {
    expect(() =>
      assertStartupConfiguration(config({ credentialsKey: '', allowInsecureDevJwt: true })),
    ).toThrow(/MARKETPLACE_CREDENTIALS_KEY/);
  });

  it('names every invalid variable in one error', () => {
    const attempt = () => assertStartupConfiguration(config({ jwtSecret: '', credentialsKey: '' }));

    expect(attempt).toThrow(/JWT_SECRET/);
    expect(attempt).toThrow(/MARKETPLACE_CREDENTIALS_KEY/);
  });

  it('gives each problem the hint that fixes that problem, on its own line', () => {
    let message = '';
    try {
      assertStartupConfiguration(config({ jwtSecret: '', credentialsKey: 'not-a-key' }));
    } catch (error) {
      message = (error as Error).message;
    }
    const lineAbout = (name: string) => message.split('\n').find((line) => line.includes(name));

    expect(lineAbout('JWT_SECRET')).toContain('npm run env:init');
    expect(lineAbout('JWT_SECRET')).not.toContain('openssl');
    expect(lineAbout('MARKETPLACE_CREDENTIALS_KEY')).toContain('openssl rand -base64 32');
    expect(lineAbout('MARKETPLACE_CREDENTIALS_KEY')).not.toContain('npm run env:init');
  });

  it('never echoes the rejected secret values', () => {
    const jwtSecret = 'leaky-jwt-value';
    const credentialsKey = 'leaky-credentials-key';
    let message = '';

    try {
      assertStartupConfiguration(config({ jwtSecret, credentialsKey }));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('JWT_SECRET');
    expect(message).not.toContain(jwtSecret);
    expect(message).not.toContain(credentialsKey);
  });

  it.each([
    ['development', false, false],
    ['development', true, true],
    ['test', false, true],
    ['production', false, false],
    ['production', true, false],
  ])(
    'insecureDevJwtAllowed in %s with the flag %s is %s, so the gate and the boot warning agree',
    (nodeEnv, allowInsecureDevJwt, allowed) => {
      expect(insecureDevJwtAllowed(config({ nodeEnv, allowInsecureDevJwt }))).toBe(allowed);
    },
  );

  it.each([
    '',
    'not-a-key',
    Buffer.alloc(16).toString('base64'),
    Buffer.alloc(32).toString('base64'),
    Buffer.alloc(33).toString('base64'),
  ])('agrees with AesGcmCredentialVault on whether %p is a usable credentials key', (credentialsKey) => {
    const vaultAccepts = () => {
      try {
        new AesGcmCredentialVault(credentialsKey);
        return true;
      } catch {
        return false;
      }
    };
    const startupAccepts = () => {
      try {
        assertStartupConfiguration(config({ credentialsKey }));
        return true;
      } catch (error) {
        // Only a credentials-key rejection counts; any other failure is a real error.
        if (!/MARKETPLACE_CREDENTIALS_KEY/.test((error as Error).message)) throw error;
        return false;
      }
    };

    expect(startupAccepts()).toBe(vaultAccepts());
  });
});
