// Boot configuration contract. main.ts calls assertStartupConfiguration(env) before it
// touches any resource, but main.ts starts a server on import, so it is not loaded here.
// These tests build the real `env` module from raw variables, the way a fresh checkout
// would, and assert what the operator would see. No process is spawned.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type EnvModule = typeof import('../config/env');

// config/env calls dotenv.config() on import, which would let a developer's local .env
// leak into a suite that asserts defaults from raw variables. doMock is not hoisted, so
// this file's own `dotenv.parse` calls above keep the real module.
jest.doMock('dotenv', () => {
  const actual = jest.requireActual<typeof import('dotenv')>('dotenv');
  const stub = { ...actual, config: () => ({ parsed: {} }) };
  return { __esModule: true, ...stub, default: stub };
});


const envExamplePath = path.resolve(__dirname, '../../../.env.example');
const savedVariables = new Map<string, string | undefined>();

// Sets process.env for the test (undefined unsets a variable) and remembers the original
// values for afterEach.
function setProcessEnv(variables: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(variables)) {
    if (!savedVariables.has(name)) savedVariables.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// Imports a fresh copy of config/env so `env` is rebuilt from the current process.env.
async function loadEnvModule(): Promise<EnvModule> {
  let loaded: EnvModule | undefined;
  await jest.isolateModulesAsync(async () => {
    loaded = await import('../config/env');
  });
  if (!loaded) throw new Error('config/env did not load');
  return loaded;
}

function generatedSecret(): string {
  return randomBytes(32).toString('base64');
}

afterEach(() => {
  for (const [name, value] of savedVariables) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedVariables.clear();
});

describe('boot configuration', () => {
  it('boot fails fast when MARKETPLACE_CREDENTIALS_KEY is empty', async () => {
    const example = dotenv.parse(readFileSync(envExamplePath));
    setProcessEnv({
      NODE_ENV: 'development',
      ALLOW_INSECURE_DEV_JWT: 'false',
      JWT_SECRET: example.JWT_SECRET ?? '',
      MARKETPLACE_CREDENTIALS_KEY: example.MARKETPLACE_CREDENTIALS_KEY ?? '',
    });
    const { env, assertStartupConfiguration } = await loadEnvModule();

    const boot = () => assertStartupConfiguration(env);

    expect(boot).toThrow(/MARKETPLACE_CREDENTIALS_KEY.*npm run env:init/);
    expect(boot).toThrow(/JWT_SECRET.*npm run env:init/);
  });

  it('boot proceeds once every secret is a generated 32-byte base64 value', async () => {
    setProcessEnv({
      NODE_ENV: 'development',
      ALLOW_INSECURE_DEV_JWT: 'false',
      JWT_SECRET: generatedSecret(),
      MARKETPLACE_CREDENTIALS_KEY: generatedSecret(),
    });
    const { env, assertStartupConfiguration } = await loadEnvModule();

    expect(() => assertStartupConfiguration(env)).not.toThrow();
  });

  it('boot with ALLOW_INSECURE_DEV_JWT=true still fails on the missing credentials key only', async () => {
    const example = dotenv.parse(readFileSync(envExamplePath));
    setProcessEnv({
      NODE_ENV: 'development',
      ALLOW_INSECURE_DEV_JWT: 'true',
      JWT_SECRET: example.JWT_SECRET ?? '',
      MARKETPLACE_CREDENTIALS_KEY: example.MARKETPLACE_CREDENTIALS_KEY ?? '',
    });
    const { env, assertStartupConfiguration } = await loadEnvModule();
    let message = '';

    try {
      assertStartupConfiguration(env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('MARKETPLACE_CREDENTIALS_KEY');
    expect(message).not.toContain('JWT_SECRET');
  });

  // Regression guard: a production placeholder used to throw while the env module was imported,
  // so the operator got a bare stack trace naming one variable and no fix.
  it('boot in production reports a placeholder JWT_SECRET with the other problems instead of crashing at import', async () => {
    setProcessEnv({
      NODE_ENV: 'production',
      DB_SSL_MODE: 'disable',
      JWT_SECRET: 'your_jwt_secret_key_change_in_production',
      MARKETPLACE_CREDENTIALS_KEY: '',
    });
    const { env, assertStartupConfiguration } = await loadEnvModule();

    const boot = () => assertStartupConfiguration(env);

    expect(boot).toThrow(/JWT_SECRET is empty or still a placeholder.*npm run env:init/);
    expect(boot).toThrow(/MARKETPLACE_CREDENTIALS_KEY is empty.*npm run env:init/);
  });

  it('production with a placeholder JWT_SECRET signs no token even for an entrypoint that skips the gate', async () => {
    setProcessEnv({
      NODE_ENV: 'production',
      DB_SSL_MODE: 'disable',
      JWT_SECRET: 'your_jwt_secret_key_change_in_production',
    });
    let auth: typeof import('../presentation/http/middleware/AuthMiddleware') | undefined;
    await jest.isolateModulesAsync(async () => {
      auth = await import('../presentation/http/middleware/AuthMiddleware');
    });
    if (!auth) throw new Error('AuthMiddleware did not load');

    expect(() => auth?.signToken({ userId: 'u-1' })).toThrow('secretOrPrivateKey must have a value');
  });

  it.each([
    ['unset', undefined],
    ['still the .env.example placeholder', 'your_jwt_refresh_secret_key_change_in_production'],
  ])(
    'boot in production does not need JWT_REFRESH_SECRET, which is %s',
    async (_label, refreshSecret) => {
      setProcessEnv({
        NODE_ENV: 'production',
        DB_SSL_MODE: 'disable',
        JWT_SECRET: generatedSecret(),
        MARKETPLACE_CREDENTIALS_KEY: generatedSecret(),
        JWT_REFRESH_SECRET: refreshSecret,
      });
      const { env, assertStartupConfiguration } = await loadEnvModule();

      expect(() => assertStartupConfiguration(env)).not.toThrow();
    }
  );

  it('issues tokens that last 7 days when JWT_EXPIRATION is unset', async () => {
    setProcessEnv({ JWT_EXPIRATION: undefined });
    const { env } = await loadEnvModule();

    expect(env.jwt.expiration).toBe('7d');
  });

  it('takes the token lifetime from JWT_EXPIRATION when it is set', async () => {
    setProcessEnv({ JWT_EXPIRATION: '12h' });
    const { env } = await loadEnvModule();

    expect(env.jwt.expiration).toBe('12h');
  });

  it('reads ALLOW_INSECURE_DEV_JWT once, so the gate does not follow later process.env changes', async () => {
    setProcessEnv({
      NODE_ENV: 'development',
      ALLOW_INSECURE_DEV_JWT: 'true',
      JWT_SECRET: 'your_jwt_secret_key_change_in_production',
      MARKETPLACE_CREDENTIALS_KEY: generatedSecret(),
    });
    const { env, assertStartupConfiguration } = await loadEnvModule();

    process.env.ALLOW_INSECURE_DEV_JWT = 'false';

    expect(env.allowInsecureDevJwt).toBe(true);
    expect(() => assertStartupConfiguration(env)).not.toThrow();
  });
});
