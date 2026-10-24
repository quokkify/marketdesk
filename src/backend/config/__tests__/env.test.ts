// S1: the JWT secret resolver must fail-closed in production and return a
// clearly-marked dev-only value outside production.

import { AesGcmCredentialVault } from '../../infrastructure/security/AesGcmCredentialVault';
import {
  assertStartupConfiguration,
  env,
  positiveInt,
  resolveDatabaseSslMode,
  resolveJwtSecret,
  resolvePublicBaseUrl,
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

describe('resolvePublicBaseUrl', () => {
  const redirectUri = 'https://marketdesk.example.com/api/marketplaces/olx/oauth/callback';

  it('uses PUBLIC_BASE_URL, keeping a path prefix and dropping trailing slashes', () => {
    expect(resolvePublicBaseUrl(' https://shop.example.com/desk/ ', redirectUri)).toBe(
      'https://shop.example.com/desk',
    );
  });

  it('derives the origin of OLX_REDIRECT_URI when PUBLIC_BASE_URL is unset', () => {
    expect(resolvePublicBaseUrl(undefined, redirectUri)).toBe('https://marketdesk.example.com');
    expect(resolvePublicBaseUrl('  ', redirectUri)).toBe('https://marketdesk.example.com');
  });

  it.each([undefined, '', 'not a url', 'ftp://files.example.com/callback'])(
    'falls back to http://localhost:3000 for OLX_REDIRECT_URI %p',
    (value) => {
      expect(resolvePublicBaseUrl(undefined, value)).toBe('http://localhost:3000');
    },
  );

  it.each([
    'shop.example.com',
    'ftp://shop.example.com',
    'https://shop.example.com/?x=1',
    'https://shop.example.com/#top',
  ])('rejects PUBLIC_BASE_URL %s', (value) => {
    expect(() => resolvePublicBaseUrl(value, redirectUri)).toThrow(/PUBLIC_BASE_URL/);
  });

  it('rebuilds PUBLIC_BASE_URL from origin and path, so a bare ? or # never reaches an image URL', () => {
    expect(resolvePublicBaseUrl('https://shop.example.com?', redirectUri)).toBe('https://shop.example.com');
    expect(resolvePublicBaseUrl('https://shop.example.com/desk/#', redirectUri)).toBe(
      'https://shop.example.com/desk',
    );
  });

  it('rejects credentials in PUBLIC_BASE_URL without echoing them', () => {
    let message = '';
    try {
      resolvePublicBaseUrl('https://seller:s3cret@shop.example.com', redirectUri);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/PUBLIC_BASE_URL/);
    expect(message).not.toContain('s3cret');
  });
});

describe('resolveJwtSecret (S1 fail-closed JWT secret)', () => {
  describe('production', () => {
    const PROD = true;

    it('throws when the secret is unset', () => {
      expect(() => resolveJwtSecret(undefined, 'JWT_SECRET', PROD)).toThrow(
        /JWT_SECRET/,
      );
    });

    it('throws when the secret is an empty string', () => {
      expect(() => resolveJwtSecret('', 'JWT_SECRET', PROD)).toThrow(/JWT_SECRET/);
    });

    it('throws when the secret is still a your_-prefixed placeholder', () => {
      expect(() =>
        resolveJwtSecret('your_jwt_secret_key_change_in_production', 'JWT_SECRET', PROD),
      ).toThrow(/JWT_SECRET/);
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
  let savedInsecureFlag: string | undefined;

  beforeEach(() => {
    savedInsecureFlag = process.env.ALLOW_INSECURE_DEV_JWT;
    delete process.env.ALLOW_INSECURE_DEV_JWT;
  });

  afterEach(() => {
    if (savedInsecureFlag === undefined) delete process.env.ALLOW_INSECURE_DEV_JWT;
    else process.env.ALLOW_INSECURE_DEV_JWT = savedInsecureFlag;
  });

  // A development-mode configuration that is valid; each test breaks exactly one thing.
  function config(
    overrides: {
      nodeEnv?: string;
      jwtSecret?: string;
      credentialsKey?: string;
      olxAdapterMode?: string;
      publicBaseUrl?: string;
      publicBaseUrlConfigured?: boolean;
    } = {},
  ): typeof env {
    return {
      ...env,
      nodeEnv: overrides.nodeEnv ?? 'development',
      jwt: { ...env.jwt, secret: overrides.jwtSecret ?? strongJwtSecret },
      marketplaceCredentialsKey: overrides.credentialsKey ?? validCredentialsKey,
      publicBaseUrl: overrides.publicBaseUrl ?? env.publicBaseUrl,
      publicBaseUrlConfigured: overrides.publicBaseUrlConfigured ?? env.publicBaseUrlConfigured,
      marketplaces: {
        ...env.marketplaces,
        olx: {
          ...env.marketplaces.olx,
          adapterMode: overrides.olxAdapterMode ?? env.marketplaces.olx.adapterMode,
        },
      },
    };
  }

  describe('PUBLIC_BASE_URL while OLX runs for real', () => {
    const realBoot = (publicBaseUrl: string, publicBaseUrlConfigured = true) => () =>
      assertStartupConfiguration(
        config({ olxAdapterMode: 'real', publicBaseUrl, publicBaseUrlConfigured }),
      );

    it('refuses an empty PUBLIC_BASE_URL with a one-line hint', () => {
      const boot = realBoot('http://localhost:3000', false);

      expect(boot).toThrow(/PUBLIC_BASE_URL is empty while OLX_ADAPTER_MODE=real/);
      expect(boot).toThrow(/Fix: set PUBLIC_BASE_URL to the public URL of this backend/);
      expect(boot).not.toThrow(/npm run env:init/);
    });

    it.each([
      'http://localhost:3000',
      'http://app.localhost',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://[::ffff:127.0.0.1]:3000',
      'http://10.0.0.5',
      'http://172.20.0.3',
      'http://192.168.1.10',
      'http://169.254.10.1',
      'http://[fd00::5]',
      'http://backend:3000',
    ])('refuses the loopback or private PUBLIC_BASE_URL %s', (publicBaseUrl) => {
      expect(realBoot(publicBaseUrl)).toThrow(
        /PUBLIC_BASE_URL points at a loopback or private address while OLX_ADAPTER_MODE=real/,
      );
    });

    it('accepts a public PUBLIC_BASE_URL', () => {
      expect(realBoot('https://marketdesk.example.com')).not.toThrow();
      expect(realBoot('https://203.0.113.10')).not.toThrow();
    });

    it('keeps the local fallback while OLX runs in the sandbox', () => {
      expect(() =>
        assertStartupConfiguration(
          config({
            olxAdapterMode: 'stub',
            publicBaseUrl: 'http://localhost:3000',
            publicBaseUrlConfigured: false,
          }),
        ),
      ).not.toThrow();
    });
  });

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
      /MARKETPLACE_CREDENTIALS_KEY.*32-byte.*npm run env:init/,
    );
  });

  it.each([
    ['empty', '', /JWT_SECRET is empty or still a placeholder/],
    [
      'the .env.example placeholder',
      'your_jwt_secret_key_change_in_production',
      /JWT_SECRET is empty or still a placeholder/,
    ],
    [
      'the development fallback that resolveJwtSecret generates',
      resolveJwtSecret(undefined, 'JWT_SECRET', false),
      /JWT_SECRET is empty or still a placeholder/,
    ],
    [
      'a dev-only fallback value, however long',
      `dev-only-insecure-${'x'.repeat(20)}`,
      /JWT_SECRET is empty or still a placeholder/,
    ],
    ['31 characters long', 'a'.repeat(31), /JWT_SECRET is shorter than 32 characters/],
  ])('rejects a JWT_SECRET that is %s outside test mode', (_label, jwtSecret, diagnosis) => {
    const boot = () => assertStartupConfiguration(config({ jwtSecret }));

    expect(boot).toThrow(diagnosis);
    expect(boot).toThrow(/JWT_SECRET.*npm run env:init/);
  });

  it('accepts a JWT_SECRET of exactly 32 characters', () => {
    expect(() => assertStartupConfiguration(config({ jwtSecret: 'a'.repeat(32) }))).not.toThrow();
  });

  it('accepts a placeholder JWT_SECRET only when ALLOW_INSECURE_DEV_JWT=true', () => {
    const placeholder = config({ jwtSecret: 'your_jwt_secret_key_change_in_production' });

    expect(() => assertStartupConfiguration(placeholder)).toThrow(/JWT_SECRET/);

    process.env.ALLOW_INSECURE_DEV_JWT = 'true';
    expect(() => assertStartupConfiguration(placeholder)).not.toThrow();
  });

  it('treats test mode like ALLOW_INSECURE_DEV_JWT=true so Jest suites keep short secrets', () => {
    expect(() =>
      assertStartupConfiguration(config({ nodeEnv: 'test', jwtSecret: 'ci-short' })),
    ).not.toThrow();
  });

  it('ignores ALLOW_INSECURE_DEV_JWT in production', () => {
    process.env.ALLOW_INSECURE_DEV_JWT = 'true';

    expect(() =>
      assertStartupConfiguration(config({ nodeEnv: 'production', jwtSecret: 'a'.repeat(31) })),
    ).toThrow(/JWT_SECRET/);
  });

  it('does not let ALLOW_INSECURE_DEV_JWT bypass the credentials key', () => {
    process.env.ALLOW_INSECURE_DEV_JWT = 'true';

    expect(() => assertStartupConfiguration(config({ credentialsKey: '' }))).toThrow(
      /MARKETPLACE_CREDENTIALS_KEY/,
    );
  });

  it('names every invalid variable in one error', () => {
    const attempt = () => assertStartupConfiguration(config({ jwtSecret: '', credentialsKey: '' }));

    expect(attempt).toThrow(/JWT_SECRET/);
    expect(attempt).toThrow(/MARKETPLACE_CREDENTIALS_KEY/);
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
