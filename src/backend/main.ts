import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { currentRun } from './application/runs/runContext.js';
import {
  assertStartupConfiguration,
  env,
  insecureDevJwtAllowed,
  isDevelopment,
  isTest,
} from './config/env.js';
import { createPool } from './config/database.js';
import { createRedisClient } from './config/redis.js';
import { buildApp } from './presentation/http/app.js';
import { createReadinessHandler } from './presentation/http/readiness.js';
import { buildContainer, type AppContainer } from './config/di/index.js';
import { createRunRecorder, envSecretEntries, registerEnvSecrets, resolveRunRecorder } from './config/runRecorder.js';
import type { IRunRecorder } from './application/ports/IRunRecorder.js';
import { FileRunRecorder } from './infrastructure/runRecorder/FileRunRecorder.js';
import { safeErrorDetails } from './config/safeErrorDetails.js';
import { verifyUploadStorageWritable } from './infrastructure/storage/verifyUploadStorage.js';

const logger = pino({
  level: env.logLevel,
  mixin: () => {
    const run = currentRun();
    return run ? { runId: run.runId } : {};
  },
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined
});

const startupSensitiveValues = envSecretEntries(env).map(([, value]) => value);

// Composition seam. The DI container (config/di) constructs the full object graph
// — repositories, infrastructure services, ports and application services — and
// returns an AppDeps-compatible container plus the lifecycle handles needed for
// graceful shutdown.
function resolveContainer(runRecorder: IRunRecorder): AppContainer {
  return buildContainer({ logger, runRecorder });
}

const startServer = async () => {
  try {
    // Refuse to boot on missing or placeholder secrets before touching any resource, so a
    // fresh `.env` fails with one actionable message instead of a half-working process.
    assertStartupConfiguration(env);
    if (insecureDevJwtAllowed(env)) {
      logger.warn(
        'JWT secret checks are relaxed (ALLOW_INSECURE_DEV_JWT=true or NODE_ENV=test). Use this for local development only.',
      );
    }

    const uploadsDir = await verifyUploadStorageWritable(env.upload.uploadDir);
    logger.info({ uploadsDir }, 'Upload storage writable');

    const pool = createPool();
    logger.info('Database pool created');

    createRedisClient();
    logger.info('Redis client created');

    await pool.query('SELECT NOW()');
    logger.info('Database connection verified');

    // A wiring failure is fatal in every environment: the catch below logs it and exits 1,
    // so the process never answers /health while every /api route is missing.
    registerEnvSecrets(env);
    const runRecorderState = resolveRunRecorder(env);
    const runRecorder = createRunRecorder(runRecorderState, (error) => {
      logger.warn({ error: safeErrorDetails(error, startupSensitiveValues) }, 'Run recorder fault');
    });
    if (runRecorder instanceof FileRunRecorder) runRecorder.start({ nodeEnv: env.nodeEnv });
    logger.info(
      { runRecorder: runRecorderState },
      runRecorderState.enabled ? 'Run recorder on' : 'Run recorder off',
    );
    const container = resolveContainer(runRecorder);
    const app = buildApp(container.deps, {
      enableRateLimit: !isTest,
      corsOrigin: env.cors.origin,
      applicationVersion: env.applicationVersion,
    });
    logger.info('API layer mounted via buildApp(deps)');
    logger.info(
      {
        olxAdapterMode: env.marketplaces.olx.adapterMode,
        hermesProviderMode: env.hermes.providerMode,
      },
      'Runtime modes',
    );

    // Trust one reverse proxy only when explicitly enabled. In the tunnel setup
    // Docker publishes this service on loopback, preventing direct XFF spoofing.
    if (env.trustProxy) app.set('trust proxy', 1);

    // Health/readiness endpoints are owned by the process, not the API layer.
    // Rate-limit health checks to prevent DoS attacks on startup/shutdown probes.
    const healthLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      skip: () => isTest,
    });

    app.get('/health', healthLimiter, (_req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: env.nodeEnv,
        version: env.applicationVersion,
      });
    });

    app.get(
      '/ready',
      healthLimiter,
      createReadinessHandler(
        {
          database: () => createPool().query('SELECT NOW()'),
          redis: () => createRedisClient().ping(),
        },
        logger,
      ),
    );

    // Product images must be publicly reachable while OLX imports them.
    app.use(
      '/uploads',
      express.static(uploadsDir, { dotfiles: 'deny', index: false, maxAge: '1h' }),
    );

    // Serve the built frontend (single-service deployment) when a production build
    // exists at dist/frontend. Registered AFTER the /api router + its 404 handler so
    // API requests are never shadowed; skipped in dev where Vite serves the SPA on
    // :5173. The catch-all returns index.html for client-side routes (SPA fallback),
    // excluding /api, /health and /ready which are handled above.
    const frontendDir = path.resolve(process.cwd(), 'dist/frontend');
    const indexHtml = path.join(frontendDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      // Rate limit SPA fallback to prevent file system exhaustion
      const spaLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        skip: () => isTest,
      });
      app.use(express.static(frontendDir));
      app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (
          !['GET', 'HEAD'].includes(req.method) ||
          req.path.startsWith('/api') ||
          req.path === '/health' ||
          req.path === '/ready'
        ) {
          return next();
        }
        spaLimiter(req, res, () => res.sendFile(indexHtml));
      });
      logger.info({ frontendDir }, 'Serving built frontend (SPA) from backend');
    } else {
      logger.info('No built frontend found (dist/frontend); serving API only');
    }

    const server = http.createServer(app);

    server.listen(env.appPort, () => {
      logger.info(
        { port: env.appPort, environment: env.nodeEnv },
        `${env.appName} server started`,
      );
    });

    // The entry point owns ALL process signal handling and the single ordered
    // graceful-shutdown path. Config modules (config/redis, config/database)
    // must not register signal handlers or call process.exit — otherwise a
    // config-side handler could exit the process before this sequence finishes.
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received, starting graceful shutdown`);
      // Closes the Bull queues, Redis client and pg pool.
      await container.shutdown();
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error(
      { error: safeErrorDetails(error, startupSensitiveValues) },
      'Failed to start server',
    );
    process.exit(1);
  }
};

startServer();
