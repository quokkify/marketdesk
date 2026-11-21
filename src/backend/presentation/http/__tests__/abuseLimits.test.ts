// Regression guards for the 2026-11-20 security audit: the AI routes get their own tight
// per-workspace limiter, login failures are limited per account, registration can be switched
// off, and readiness answers never carry driver error text.

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { InMemoryAuthStore } from '../../testkit/support';
import {
  aiRateLimiter,
  loginFailureKey,
  loginFailureRateLimiter,
} from '../middleware/RateLimitMiddleware';
import { createProductRoutes } from '../routes/products';
import { createHermesRoutes } from '../routes/hermes';
import { createAuthRoutes } from '../routes/auth';
import { createReadinessHandler } from '../readiness';
import type { ProductController } from '../controllers/ProductController';
import type { HermesController } from '../controllers/HermesController';
import type { AuthController } from '../controllers/AuthController';

const currentUserStore = new InMemoryAuthStore();

const okHandler: RequestHandler = (_req, res) => {
  res.json({ success: true });
};

// Every handler answers 200, so a 429 can only come from a limiter.
const anyController = new Proxy({}, { get: () => okHandler });

// Tests stand in for the auth guard: the workspace comes from a header.
const asWorkspace: RequestHandler = (req, _res, next) => {
  req.user = {
    userId: 'u-1',
    workspaceId: req.header('x-workspace'),
    tokenVersion: 0,
    issuedAt: 0,
  };
  next();
};

describe('AI rate limiter (regression guard)', () => {
  function appWithAiLimit(limit: number): express.Express {
    const app = express();
    app.use(express.json());
    app.use(asWorkspace);
    const aiLimiter = aiRateLimiter(limit);
    app.use(
      '/products',
      createProductRoutes(anyController as unknown as ProductController, aiLimiter)
    );
    app.use('/hermes', createHermesRoutes(anyController as unknown as HermesController, aiLimiter));
    return app;
  }

  const aiCalls: Array<[string, string]> = [
    ['post', '/products/ai-draft'],
    ['post', '/products/p-1/recheck'],
    ['post', '/products/p-1/improvements'],
    ['post', '/hermes/products/p-1/run'],
  ];

  it.each(aiCalls)('rejects %s %s once the workspace has used the configured allowance', async (_m, path) => {
    const app = appWithAiLimit(2);
    const call = () => request(app).post(path).set('x-workspace', 'ws-a').send({});

    const first = await call();
    const second = await call();
    const third = await call();

    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' },
    });
  });

  it('shares one allowance across all AI routes of a workspace', async () => {
    const app = appWithAiLimit(2);

    await request(app).post('/products/ai-draft').set('x-workspace', 'ws-a').send({});
    await request(app).post('/hermes/products/p-1/run').set('x-workspace', 'ws-a').send({});
    const third = await request(app).post('/products/p-1/improvements').set('x-workspace', 'ws-a').send({});

    expect(third.status).toBe(429);
  });

  it('keeps a separate allowance per workspace', async () => {
    const app = appWithAiLimit(2);
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/products/ai-draft').set('x-workspace', 'ws-a').send({});
    }

    const other = await request(app).post('/products/ai-draft').set('x-workspace', 'ws-b').send({});

    expect(other.status).not.toBe(429);
  });

  it('does not limit routes that do not call the AI', async () => {
    const app = appWithAiLimit(1);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await request(app).get('/products').set('x-workspace', 'ws-a')).status);
      statuses.push((await request(app).get('/hermes/status').set('x-workspace', 'ws-a')).status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});

describe('login failure limiter (regression guard)', () => {
  const WINDOW_MS = 15 * 60 * 1000;

  // A stand-in for AuthController.login: one known account with one password.
  const login: RequestHandler = (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    if (email === 'demo@example.com' && password === 'secret123') {
      res.json({ success: true, data: { token: 't' } });
      return;
    }
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
    });
  };

  function appWithLoginLimit(limit: number): express.Express {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    const controller = { login } as unknown as AuthController;
    app.use(
      '/auth',
      createAuthRoutes(controller, undefined, {
        currentUserStore,
        loginLimiter: loginFailureRateLimiter(limit),
      })
    );
    return app;
  }

  let ipCounter = 0;
  const attempt = (app: express.Express, email: string, password: string) => {
    ipCounter += 1;
    return request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', `203.0.113.${ipCounter % 250}`)
      .send({ email, password });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks an account after N failures even when each attempt comes from another IP', async () => {
    const app = appWithLoginLimit(3);
    for (let i = 0; i < 3; i += 1) {
      expect((await attempt(app, 'demo@example.com', 'wrong')).status).toBe(401);
    }

    const blocked = await attempt(app, 'demo@example.com', 'secret123');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('keys the account by normalised e-mail', async () => {
    const app = appWithLoginLimit(2);
    await attempt(app, 'Demo@Example.com', 'wrong');
    await attempt(app, 'demo@EXAMPLE.com', 'wrong');

    expect((await attempt(app, 'DEMO@EXAMPLE.COM', 'wrong')).status).toBe(429);
  });

  it('answers an unknown e-mail exactly like a known one', async () => {
    const app = appWithLoginLimit(2);
    const known: request.Response[] = [];
    const unknown: request.Response[] = [];
    for (let i = 0; i < 3; i += 1) {
      known.push(await attempt(app, 'demo@example.com', 'wrong'));
      unknown.push(await attempt(app, 'nobody@example.com', 'wrong'));
    }

    const shape = (res: request.Response) => ({
      status: res.status,
      body: res.body,
      ratelimit: res.headers['ratelimit'],
      policy: res.headers['ratelimit-policy'],
      retryAfter: res.headers['retry-after'],
    });
    expect(known.map(shape)).toEqual(unknown.map(shape));
    expect(known.map((res) => res.status)).toEqual([401, 401, 429]);
  });

  it('does not count successful logins', async () => {
    const app = appWithLoginLimit(2);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await attempt(app, 'demo@example.com', 'secret123')).status);
    }
    statuses.push((await attempt(app, 'demo@example.com', 'wrong')).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 401]);
  });

  // Regression guard (review of #462): an e-mail of megabytes passed validation and became a
  // limiter key held in memory for the whole window.
  it('rejects an over-long e-mail with 400 before the limiter sees it', async () => {
    const limiterHits = jest.fn();
    const spyLimiter: RequestHandler = (_req, _res, next) => {
      limiterHits();
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/auth',
      createAuthRoutes({ login } as unknown as AuthController, undefined, {
        currentUserStore,
        loginLimiter: spyLimiter,
      })
    );
    const tooLong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;

    const res = await request(app).post('/auth/login').send({ email: tooLong, password: 'x' });

    expect(res.status).toBe(400);
    expect(limiterHits).not.toHaveBeenCalled();
  });

  it('keys the limiter by a fixed-size digest of the normalised e-mail', () => {
    const keyOf = (email: string) => loginFailureKey({ body: { email } } as express.Request);
    const short = keyOf('a@b.co');
    const long = keyOf(`${'a'.repeat(100_000)}@b.co`);

    expect(long).toHaveLength(short.length);
    expect(short).toMatch(/^login:[0-9a-f]{64}$/);
    expect(keyOf(' A@B.CO ')).toBe(short);
    expect(short).not.toContain('a@b.co');
  });

  it('lets the account sign in again once the window has passed', async () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const app = appWithLoginLimit(2);
    await attempt(app, 'demo@example.com', 'wrong');
    await attempt(app, 'demo@example.com', 'wrong');
    expect((await attempt(app, 'demo@example.com', 'secret123')).status).toBe(429);

    now.mockReturnValue(start + WINDOW_MS + 1);

    expect((await attempt(app, 'demo@example.com', 'secret123')).status).toBe(200);
  });
});

describe('registration switch (regression guard)', () => {
  const register: RequestHandler = (_req, res) => {
    res.status(201).json({ success: true });
  };
  const controller = { register } as unknown as AuthController;
  const body = { email: 'new@example.com', password: 'secret123', workspaceName: 'New' };

  function appWith(options?: { registrationEnabled?: boolean }): express.Express {
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRoutes(controller, undefined, { currentUserStore, ...options }));
    return app;
  }

  it('answers 403 with a clear message when registration is disabled', async () => {
    const res = await request(appWith({ registrationEnabled: false })).post('/auth/register').send(body);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Registration is disabled on this instance. Ask the administrator for an account.',
      },
    });
  });

  it('keeps registration open by default', async () => {
    const res = await request(appWith()).post('/auth/register').send(body);

    expect(res.status).toBe(201);
  });
});

describe('readiness (regression guard)', () => {
  const driverError = Object.assign(
    new Error('password authentication failed for user "marketdesk" at 10.0.0.5:5432'),
    { code: '28P01' }
  );

  function appWith(checks: { database: () => Promise<unknown>; redis: () => Promise<unknown> }) {
    const logged: unknown[] = [];
    const app = express();
    app.get(
      '/ready',
      createReadinessHandler(checks, { error: (details: unknown) => logged.push(details) })
    );
    return { app, logged };
  }

  it('reports component status without the driver error text', async () => {
    const { app, logged } = appWith({
      database: () => Promise.reject(driverError),
      redis: () => Promise.resolve('PONG'),
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'not_ready',
      database: 'unavailable',
      redis: 'connected',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|10\.0\.0\.5|marketdesk/);
    // The log names the component, error class and code, never the driver message, which can
    // carry the database user or host (review of #462).
    expect(logged).toEqual([{ component: 'database', errorName: 'Error', errorCode: '28P01' }]);
  });

  it('answers ready when every component is connected', async () => {
    const { app } = appWith({
      database: () => Promise.resolve(),
      redis: () => Promise.resolve('PONG'),
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', database: 'connected', redis: 'connected' });
  });
});
