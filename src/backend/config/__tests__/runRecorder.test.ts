import { env } from '../env';
import { createRunRecorder, registerEnvSecrets, resolveRunRecorder } from '../runRecorder';
import { noopRunRecorder } from '../../application/ports/IRunRecorder';
import { FileRunRecorder } from '../../infrastructure/runRecorder/FileRunRecorder';
import { SecretRegistry } from '../../infrastructure/runRecorder/SecretRegistry';

const base = { runRecorder: { mode: '', dir: '/tmp/x' } };
const ok = () => ({ ok: true as const });

describe('resolveRunRecorder', () => {
  it.each([
    ['production', '', { enabled: false, reason: 'production' }],
    ['test', '', { enabled: false, reason: 'test' }],
    ['development', 'off', { enabled: false, reason: 'switched-off' }],
    ['development', ' OFF ', { enabled: false, reason: 'switched-off' }],
  ])('is off in %s with RUN_RECORDER=%s', (nodeEnv, mode, expected) => {
    expect(resolveRunRecorder({ nodeEnv, runRecorder: { mode, dir: '/tmp/x' } }, ok)).toEqual(expected);
  });

  it('is on in development and resolves the directory to an absolute path', () => {
    expect(resolveRunRecorder({ nodeEnv: 'development', ...base }, ok)).toEqual({ enabled: true, dir: '/tmp/x' });
    expect(
      resolveRunRecorder({ nodeEnv: 'development', runRecorder: { mode: '', dir: './.local/runs' } }, ok),
    ).toEqual({ enabled: true, dir: expect.stringMatching(/^\/.*\.local\/runs$/) });
  });

  it('is off in production even when the directory is set and writable', () => {
    expect(resolveRunRecorder({ nodeEnv: 'production', ...base }, ok).enabled).toBe(false);
  });

  it('turns itself off when the directory is not writable, with the reason', () => {
    expect(resolveRunRecorder({ nodeEnv: 'development', ...base }, () => ({ ok: false, reason: 'EACCES' })))
      .toEqual({ enabled: false, reason: 'not-writable', detail: 'EACCES' });
  });

  it.each(['staging', 'Production', ''])(
    'regression guard: is off for the non-development NODE_ENV %p without probing',
    (nodeEnv) => {
      const probe = jest.fn(ok);
      expect(resolveRunRecorder({ nodeEnv, ...base }, probe)).toEqual({
        enabled: false,
        reason: 'not-development',
      });
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it('does not probe when the recorder would be off anyway', () => {
    const probe = jest.fn(ok);
    resolveRunRecorder({ nodeEnv: 'production', ...base }, probe);
    resolveRunRecorder({ nodeEnv: 'test', ...base }, probe);
    resolveRunRecorder({ nodeEnv: 'development', runRecorder: { mode: 'off', dir: '/tmp/x' } }, probe);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('createRunRecorder', () => {
  it('gives the no-op recorder when disabled', () => {
    expect(createRunRecorder({ enabled: false, reason: 'test' }, () => {})).toBe(noopRunRecorder);
  });

  it('gives a file recorder when enabled', () => {
    const recorder = createRunRecorder({ enabled: true, dir: '/tmp/x' }, () => {});
    expect(recorder).toBeInstanceOf(FileRunRecorder);
    expect(recorder.enabled).toBe(true);
  });
});

describe('registerEnvSecrets', () => {
  it('labels each secret by its variable name', () => {
    const r = new SecretRegistry();
    const hermesValue = ['hermes', 'value', 'for', 'test'].join('-');
    registerEnvSecrets({ ...env, hermes: { ...env.hermes, apiKey: hermesValue } } as typeof env, r);
    expect(r.scrub(`x ${hermesValue} y`)).toBe('x [ENV:HERMES_API_KEY] y');
  });

  it('registers connection URLs whole and their passwords separately', () => {
    const r = new SecretRegistry();
    const dbValue = ['db', 'value', 'unique', '1'].join('-');
    registerEnvSecrets(
      {
        ...env,
        database: { ...env.database, url: `postgres://u:${dbValue}@h/db`, password: dbValue },
        redis: { ...env.redis, url: 'redis://:redispass-unique-1@h:6379', password: 'redispass-unique-1' },
      } as typeof env,
      r,
    );
    expect(r.scrub(`a postgres://u:${dbValue}@h/db b`)).toBe('a [ENV:DATABASE_URL] b');
    expect(r.scrub(`c ${dbValue} d`)).toBe('c [ENV:DB_PASSWORD] d');
    expect(r.scrub('e redispass-unique-1 f')).toBe('e [ENV:REDIS_PASSWORD] f');
  });
});
