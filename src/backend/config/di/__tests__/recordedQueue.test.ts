import { noopRunRecorder } from '../../../application/ports/IRunRecorder';
import { currentRun, runInContext } from '../../../application/runs/runContext';
import { InvalidStateError } from '../../../domain/shared/DomainError';
import { recordedProcessor, stampRun } from '../recordedQueue';

const fake = () => ({ enabled: true, record: jest.fn(), discard: jest.fn() });

describe('stampRun', () => {
  it('adds nothing when the recorder is off', () => {
    const data = { listingId: 'l1' };
    expect(
      runInContext({ runId: 'r1', kind: 'http' }, () =>
        stampRun(data, 'publish-listing', 'j1', noopRunRecorder)
      )
    ).toBe(data);
  });

  it('adds nothing when no run is active', () => {
    const data = { listingId: 'l1' };
    expect(stampRun(data, 'q', 'j1', fake())).toBe(data);
  });

  it('stamps the run id on a copy and records the enqueue and the links', () => {
    const rec = fake();
    const data = { operationId: 'op1', listingId: 'l1', marketplaceKey: 'olx' };
    const out = runInContext({ runId: 'r1', kind: 'http' }, () =>
      stampRun(data, 'publish-listing', 'publish:op1', rec)
    );
    expect(out).toEqual({ ...data, __run: { runId: 'r1' } });
    expect(data).not.toHaveProperty('__run');
    expect(rec.record.mock.calls.map(([id, e]) => [id, e.type])).toEqual([
      ['r1', 'queue.enqueued'],
      ['r1', 'link'],
    ]);
    expect(rec.record.mock.calls[0][1].data).toEqual(data);
    expect(rec.record.mock.calls[1][1]).toEqual({
      type: 'link',
      operationId: 'op1',
      listingId: 'l1',
      marketplaceKey: 'olx',
    });
  });

  it('records no link when no link field is present', () => {
    const rec = fake();
    runInContext({ runId: 'r1', kind: 'http' }, () => stampRun({ a: 1 }, 'q', undefined, rec));
    expect(rec.record.mock.calls.map(([, e]) => e.type)).toEqual(['queue.enqueued']);
  });

  it('records the enqueue non-lazily for a lazy run', () => {
    const rec = fake();
    runInContext({ runId: 'r1', kind: 'http', lazy: true }, () =>
      stampRun({ a: 1 }, 'q', 'j', rec)
    );
    expect(rec.record.mock.calls[0][2]).toEqual({ lazy: false });
  });

  it('a throwing recorder does not fail the enqueue', () => {
    const rec = fake();
    rec.record.mockImplementation(() => {
      throw new Error('disk');
    });
    const out = runInContext({ runId: 'r1', kind: 'http' }, () =>
      stampRun({ a: 1 }, 'q', 'j', rec)
    );
    expect(out).toEqual({ a: 1, __run: { runId: 'r1' } });
  });
});

describe('recordedProcessor', () => {
  it.each([['a string'], [['an', 'array']], [null], [42]])(
    'passes non-object data %p through untouched',
    async (data) => {
      const rec = fake();
      expect(runInContext({ runId: 'r1', kind: 'http' }, () => stampRun(data, 'q', 'j', rec))).toBe(
        data
      );
      const handler = jest.fn().mockResolvedValue('done');
      await recordedProcessor('q', rec, handler)({ data, attemptsMade: 0, opts: { attempts: 3 } });
      expect(handler).toHaveBeenCalledWith(data);
    }
  );

  it('hands the handler data without __run and runs it inside the stamped run', async () => {
    const rec = fake();
    let seen: unknown;
    const handler = jest.fn(async () => {
      seen = currentRun();
      return 'ok';
    });
    await recordedProcessor(
      'publish-listing',
      rec,
      handler
    )({
      data: { listingId: 'l1', __run: { runId: 'r1' } },
      id: 'publish:op1',
      attemptsMade: 1,
      opts: { attempts: 3 },
    });
    expect(handler).toHaveBeenCalledWith({ listingId: 'l1' });
    expect(seen).toEqual({ runId: 'r1', kind: 'job', attempt: 2 });
    expect(rec.record.mock.calls.map(([, e]) => e.type)).toEqual([
      'queue.attempt.start',
      'queue.attempt.end',
    ]);
    expect(rec.record.mock.calls[0][1]).toMatchObject({ jobId: 'publish:op1' });
    expect(rec.record.mock.calls[1][1]).toMatchObject({ attempt: 2, maxAttempts: 3, ok: true });
  });

  it('strips __run even when the recorder is off, without opening a run', async () => {
    let seen: unknown = 'unset';
    const handler = jest.fn(async () => {
      seen = currentRun();
    });
    await recordedProcessor(
      'q',
      noopRunRecorder,
      handler
    )({
      data: { a: 1, __run: { runId: 'r1' } },
      attemptsMade: 0,
      opts: {},
    });
    expect(handler).toHaveBeenCalledWith({ a: 1 });
    expect(seen).toBeUndefined();
  });

  it('strips a malformed __run and starts a fresh job run', async () => {
    const rec = fake();
    const handler = jest.fn().mockResolvedValue(undefined);
    await recordedProcessor(
      'q',
      rec,
      handler
    )({
      data: { a: 1, __run: { runId: '' } },
      attemptsMade: 0,
      opts: {},
    });
    expect(handler).toHaveBeenCalledWith({ a: 1 });
    expect(rec.record.mock.calls[0][1]).toEqual({ type: 'run.start', kind: 'job', queue: 'q' });
  });

  it('starts a fresh job run for a legacy or repeat job', async () => {
    const rec = fake();
    await recordedProcessor(
      'sync-marketplace',
      rec,
      async () => undefined
    )({
      data: { a: 1 },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });
    expect(rec.record.mock.calls[0][1]).toEqual({
      type: 'run.start',
      kind: 'job',
      queue: 'sync-marketplace',
    });
  });

  describe('an unstamped job across attempts', () => {
    const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
    const LONG_TOKEN = /[A-Za-z0-9_-]{40,}/;
    const attemptJob = (id: string | undefined, attemptsMade: number) => ({
      id,
      data: { a: 1 },
      attemptsMade,
      opts: { attempts: 3 },
    });

    it('keeps one run id for every attempt and records run.start once', async () => {
      const rec = fake();
      const process = recordedProcessor('sync-marketplace', rec, async () => undefined);
      for (const made of [0, 1, 2]) await process(attemptJob('sync:abc', made));
      const ids = new Set(rec.record.mock.calls.map(([id]) => id));
      expect(ids.size).toBe(1);
      const [runId] = [...ids];
      expect(runId).toBe('job-sync-marketplace-sync-abc');
      expect(runId).toMatch(SAFE_RUN_ID);
      const starts = rec.record.mock.calls.filter(([, e]) => e.type === 'run.start');
      expect(starts).toHaveLength(1);
    });

    it('keeps getting fresh ids when the job has no id', async () => {
      const rec = fake();
      const process = recordedProcessor('q', rec, async () => undefined);
      await process(attemptJob(undefined, 0));
      await process(attemptJob(undefined, 1));
      const ids = new Set(rec.record.mock.calls.map(([id]) => id));
      expect(ids.size).toBe(2);
    });

    it('yields an accepted id for a UUID job id', async () => {
      const rec = fake();
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      await recordedProcessor('sync-marketplace', rec, async () => undefined)(
        attemptJob(uuid, 0)
      );
      const runId = rec.record.mock.calls[0][0];
      expect(runId).toMatch(SAFE_RUN_ID);
      expect(runId).not.toMatch(LONG_TOKEN);
      expect(runId).toContain(uuid);
    });

    it('falls back to a fresh id when a 40+ character run cannot be avoided', async () => {
      const rec = fake();
      await recordedProcessor('q', rec, async () => undefined)(attemptJob('x'.repeat(60), 0));
      const runId = rec.record.mock.calls[0][0];
      expect(runId).toMatch(SAFE_RUN_ID);
      expect(runId).not.toMatch(LONG_TOKEN);
    });
  });

  it('records the failure and rethrows the same error', async () => {
    const rec = fake();
    const boom = new InvalidStateError('ambiguous');
    await expect(
      recordedProcessor('q', rec, async () => {
        throw boom;
      })({ data: { __run: { runId: 'r1' } }, attemptsMade: 2, opts: { attempts: 3 } })
    ).rejects.toBe(boom);
    expect(rec.record.mock.calls[rec.record.mock.calls.length - 1]![1]).toMatchObject({
      type: 'queue.attempt.end',
      ok: false,
      attempt: 3,
      maxAttempts: 3,
      error: { name: 'InvalidStateError' },
    });
  });

  it('a throwing recorder does not fail the job', async () => {
    const rec = fake();
    rec.record.mockImplementation(() => {
      throw new Error('disk');
    });
    await expect(
      recordedProcessor('q', rec, async () => 'ok')({ data: {}, attemptsMade: 0, opts: {} })
    ).resolves.toBe('ok');
  });
});
