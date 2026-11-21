import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesLimitsReader } from './HermesLimitsReader';

// Pure state logic over real files in a temp directory (no mocks).
describe('HermesLimitsReader', () => {
  const now = new Date('2026-11-21T16:00:00Z');
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'limits-'));
    file = join(dir, 'usage.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (body: unknown) => writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const real = (fetchedAt: string) => ({
    provider: 'openai-codex',
    plan: 'Plus',
    fetched_at: fetchedAt,
    windows: [{ label: 'Session', used_percent: 0.0, resets_at: '2026-11-21T20:29:41+00:00', detail: null }],
    details: ['Credits: 12', 'You have 3 resets banked - use /usage reset to activate'],
    unavailable_reason: null,
    new_future_key: 1,
  });

  it('is not_configured without a path', async () => {
    expect((await new HermesLimitsReader('').read(now)).state).toBe('not_configured');
  });

  it('reads a fresh file, drops the reset hint and keeps unknown keys harmless', async () => {
    write(real(at(1)));
    const result = await new HermesLimitsReader(file).read(now);
    expect(result).toMatchObject({ state: 'fresh', plan: 'Plus', ageSeconds: 60, details: ['Credits: 12'] });
    expect(result.windows).toEqual([
      { label: 'Session', usedPercent: 0, resetsAt: '2026-11-21T20:29:41+00:00' },
    ]);
  });

  it('is stale after 15 minutes and keeps the values', async () => {
    write(real(at(20)));
    const result = await new HermesLimitsReader(file).read(now);
    expect(result.state).toBe('stale');
    expect(result.windows).toHaveLength(1);
  });

  it('tolerates a little clock skew but not a future date', async () => {
    write(real(at(-0.5)));
    expect(await new HermesLimitsReader(file).read(now)).toMatchObject({ state: 'fresh', ageSeconds: 0 });
    write(real(at(-5)));
    expect((await new HermesLimitsReader(file).read(now)).state).toBe('unknown');
  });

  it.each([
    ['half-written', '{"provider":'],
    ['empty', ''],
    ['a non-object', '[]'],
    ['failure marker', { unavailable_reason: 'fetch failed', fetched_at: at(0) }],
    ['no fetch time', { provider: 'x', windows: [] }],
    ['unparsable fetch time', { fetched_at: 'yesterday' }],
  ])('is unknown for %s, with no numbers', async (_name, body) => {
    write(body);
    const result = await new HermesLimitsReader(file).read(now);
    expect(result.state).toBe('unknown');
    expect(result.windows).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it('reports the failure reason verbatim', async () => {
    write({ unavailable_reason: 'fetch failed', fetched_at: at(0) });
    expect((await new HermesLimitsReader(file).read(now)).reason).toBe('fetch failed');
  });

  it('is unknown when the file is missing', async () => {
    expect((await new HermesLimitsReader(join(dir, 'nope.json')).read(now)).state).toBe('unknown');
  });
});
