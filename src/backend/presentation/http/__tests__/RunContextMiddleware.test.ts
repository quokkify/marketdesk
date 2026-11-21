import express, { type Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createRunContextMiddleware, routePattern } from '../middleware/RunContextMiddleware';
import { createErrorHandler } from '../middleware/ErrorHandlingMiddleware';
import { GuardrailViolationError, NotFoundError } from '../../../domain/shared/DomainError';
import { currentRun } from '../../../application/runs/runContext';
import { noopRunRecorder, type IRunRecorder } from '../../../application/ports/IRunRecorder';

function fakeRecorder() {
  return { enabled: true, record: jest.fn(), discard: jest.fn() };
}

function buildApp(recorder: IRunRecorder): Express {
  const app = express();
  app.use(createRunContextMiddleware(recorder));
  app.post('/api/listings/:id/publish', (_req, res) => {
    res.status(202).json({ ok: true });
  });
  app.post('/api/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/products', (_req, res) => {
    res.json([]);
  });
  app.get('/api/boom', (_req, res) => {
    res.status(500).json({ ok: false });
  });
  app.get('/api/run-id', (_req, res) => {
    res.json({ runId: currentRun()?.runId });
  });
  app.get('/api/hang', () => undefined);
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', (req, _res, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });
  app.use(createErrorHandler(undefined, recorder));
  return app;
}

describe('createRunContextMiddleware', () => {
  it('sets X-Run-Id and records run.start and http.end with the route pattern for a POST', async () => {
    const recorder = fakeRecorder();
    const res = await request(buildApp(recorder))
      .post('/api/listings/l_1/publish?token=abc')
      .send({ password: 'p' });
    const runId = res.headers['x-run-id'];
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(recorder.record.mock.calls.map(([id, e, o]) => [id, e.type, o?.lazy ?? false])).toEqual([
      [runId, 'run.start', false],
      [runId, 'http.end', false],
    ]);
    expect(recorder.record.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      path: '/api/listings/l_1/publish',
    });
    const end = recorder.record.mock.calls[1][1];
    expect(end).toMatchObject({ route: '/api/listings/:id/publish', status: 202 });
    expect(Number.isInteger(end.durationMs)).toBe(true);
    expect(JSON.stringify(recorder.record.mock.calls)).not.toMatch(/abc|password/);
  });

  it('makes the run id visible to the handler through currentRun()', async () => {
    const res = await request(buildApp(fakeRecorder())).get('/api/run-id');
    expect(res.body.runId).toBe(res.headers['x-run-id']);
  });

  it('never takes the run id from a request header', async () => {
    const res = await request(buildApp(fakeRecorder())).get('/api/run-id').set('X-Run-Id', 'evil');
    expect(res.headers['x-run-id']).not.toBe('evil');
  });

  it('discards a successful GET and a GET answered with 404', async () => {
    const recorder = fakeRecorder();
    const app = buildApp(recorder);
    await request(app).get('/api/products');
    await request(app).get('/api/missing');
    expect(recorder.discard).toHaveBeenCalledTimes(2);
    expect(recorder.record.mock.calls.every(([, , o]) => o?.lazy)).toBe(true);
    const types = recorder.record.mock.calls.map(([, e]) => e.type);
    expect(types).toContain('http.error');
  });

  it('keeps a GET answered with 500', async () => {
    const recorder = fakeRecorder();
    await request(buildApp(recorder)).get('/api/boom');
    const end = recorder.record.mock.calls.find(([, e]) => e.type === 'http.end');
    expect(end?.[1]).toMatchObject({ status: 500 });
    expect(end?.[2]?.lazy).toBe(false);
    expect(recorder.discard).not.toHaveBeenCalled();
  });

  it('does not open a run outside /api', async () => {
    const recorder = fakeRecorder();
    const res = await request(buildApp(recorder)).get('/health');
    expect(res.headers['x-run-id']).toBeUndefined();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(recorder.discard).not.toHaveBeenCalled();
  });

  it('still sets X-Run-Id when the recorder is the no-op', async () => {
    const res = await request(buildApp(noopRunRecorder)).get('/api/products');
    expect(res.headers['x-run-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records an aborted request as http.end with aborted and status 499', async () => {
    const recorder = fakeRecorder();
    const server = buildApp(recorder).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const req = http.get({ port, path: '/api/hang' });
      req.on('error', () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      req.destroy();
      const deadline = Date.now() + 2000;
      while (
        !recorder.record.mock.calls.some(([, e]) => e.type === 'http.end') &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      server.close();
    }
    const ends = recorder.record.mock.calls.filter(([, e]) => e.type === 'http.end');
    expect(ends).toHaveLength(1);
    expect(ends[0][1]).toMatchObject({ type: 'http.end', aborted: true, status: 499 });
  });

  it('a throwing recorder does not change the response', async () => {
    const recorder = fakeRecorder();
    recorder.record.mockImplementation(() => {
      throw new Error('disk full');
    });
    recorder.discard.mockImplementation(() => {
      throw new Error('disk full');
    });
    const app = buildApp(recorder);
    const ok = await request(app).post('/api/ok');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.headers['x-run-id']).toBeDefined();
    const missing = await request(app).get('/api/missing');
    expect(missing.status).toBe(404);
  });
});

describe('a fault while computing the route pattern', () => {
  it('still completes the response with its normal status', async () => {
    const recorder = fakeRecorder();
    const app = express();
    app.use(createRunContextMiddleware(recorder));
    app.use('/api', (req, res) => {
      Object.defineProperty(req, 'route', {
        get() {
          throw new Error('route getter fault');
        },
      });
      res.status(201).json({ ok: true });
    });
    const res = await request(app).post('/api/x').send({});
    expect(res.status).toBe(201);
  });
});

describe('route pattern of a request refused through a nested router', () => {
  // Regression guard: Express restores req.baseUrl before the finish event when an
  // error leaves a mounted router, so the mount prefix must not come from baseUrl.
  it('keeps the mount prefix when the handler ends through next(err)', async () => {
    const recorder = fakeRecorder();
    const app = express();
    app.use(createRunContextMiddleware(recorder));
    const router = express.Router();
    router.post('/:id/publish', (_req, _res, next) => next(new GuardrailViolationError('blocked')));
    app.use('/api/listings', router);
    app.use(createErrorHandler(undefined, recorder));

    const res = await request(app).post('/api/listings/5cc1/publish');

    expect(res.status).toBe(422);
    const end = recorder.record.mock.calls.map(([, e]) => e).find((e) => e.type === 'http.end');
    expect(end.route).toBe('/api/listings/:id/publish');
  });
});

describe('routePattern', () => {
  it.each([
    ['/api/listings/5cc1/publish', '/:id/publish', '/api/listings/:id/publish'],
    ['/api/products', '/', '/api/products'],
    ['/api/products/', '/', '/api/products'],
    ['/api/x', '/api/x', '/api/x'],
    ['/api/a/b', /b/, '/api/a/b'],
    ['/api/a/b', ['/b'], '/api/a/b'],
    ['/api/missing', undefined, '/api/missing'],
    ['/api/files/secret/x/y', '/files/*splat', '/api/files/secret/x/y'],
    ['/api/x/1', '/:id{/:sub}', '/api/x/1'],
    ['/a', '/x/y/z', '/a'],
    ['/api/x', '/x', '/api/x'],
  ])('%s with route %s is %s', (requestPath, routePath, expected) => {
    expect(routePattern(requestPath, routePath)).toBe(expected);
  });
});
