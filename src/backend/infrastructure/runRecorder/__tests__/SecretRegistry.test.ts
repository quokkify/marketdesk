import { MAX_REGISTERED_SECRETS, SecretRegistry } from '../SecretRegistry';

const token = (n: number) => `runtime-token-${String(n).padStart(6, '0')}`;

describe('SecretRegistry cap', () => {
  it('keeps at most the cap and still scrubs the newest token', () => {
    const r = new SecretRegistry();
    for (let i = 0; i < 600; i += 1) r.register(token(i), 'TOKEN');
    expect(r.size).toBeLessThanOrEqual(MAX_REGISTERED_SECRETS);
    expect(r.scrub(`a ${token(599)} b`)).toBe('a [TOKEN] b');
    expect(r.scrub(`a ${token(0)} b`)).toBe(`a ${token(0)} b`);
  });

  it('never evicts an ENV secret', () => {
    const r = new SecretRegistry();
    const envValue = 'env-value-for-the-cap-test';
    r.register(envValue, 'ENV:SOME_SECRET');
    for (let i = 0; i < 600; i += 1) r.register(token(i), 'TOKEN');
    expect(r.scrub(`x ${envValue} y`)).toBe('x [ENV:SOME_SECRET] y');
  });

  it('drops a new runtime token when every entry is an ENV entry', () => {
    const r = new SecretRegistry();
    for (let i = 0; i < MAX_REGISTERED_SECRETS; i += 1) r.register(token(i), `ENV:V${i}`);
    r.register('late-runtime-token-1', 'TOKEN');
    expect(r.size).toBe(MAX_REGISTERED_SECRETS);
    expect(r.scrub('late-runtime-token-1')).toBe('late-runtime-token-1');
  });

  it('keeps one entry when the same value is registered twice', () => {
    const r = new SecretRegistry();
    r.register(token(1), 'TOKEN');
    r.register(token(1), 'TOKEN');
    expect(r.size).toBe(1);
  });
});
