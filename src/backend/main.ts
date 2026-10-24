import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
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
import { HermesLiveUpdates } from './presentation/websocket/HermesLiveUpdates.js';
import { buildContainer, type AppContainer } from './config/di/index.js';
import { safeErrorDetails } from './config/safeErrorDetails.js';
import { verifyUploadStorageWritable } from './infrastructure/storage/verifyUploadStorage.js';

const logger = pino({
  level: env.logLevel,
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined
});

const startupSensitiveValues = [
  env.database.url,
  env.database.password,
  env.redis.url,
  env.redis.password,
  env.jwt.secret,
  env.jwt.refreshSecret,
  env.hermes.apiKey,
  env.hermes.webhookSecret,
  env.marketplaces.olx.clientSecret,
  env.marketplaces.olx.accessToken,
  env.marketplaces.olx.refreshToken,
  env.marketplaceCredentialsKey,
];

// Composition seam. The DI container (config/di) constructs the full object graph
// — repositories, infrastructure services, ports and application services — and
// returns an AppDeps-compatible container plus the WS event subscriber and the
// lifecycle handles needed for graceful shutdown.
function resolveContainer(): AppContainer {
  return buildContainer({ logger });
}

const startServer = async () => {
  try {
    // Refuse to boot on missing or placeholder secrets before touching any resource, so a
    // fresh `.env` fails with one actionable message instead of a half-working process.
    assertStartupConfiguration(env);
    if (insecureDevJwtAllowed(env)) {
      logger.warn(
        'ALLOW_INSECURE_DEV_JWT=true: JWT secret checks are relaxed. Use it for local development only.',
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
    const container = resolveContainer();
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

    app.get('/ready', healthLimiter, async (_req, res) => {
      try {
        const p = createPool();
        await p.query('SELECT NOW()');
        const r = createRedisClient();
        await r.ping();
        res.status(200).json({
          status: 'ready',
          database: 'connected',
          redis: 'connected',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Readiness check failed');
        res.status(503).json({
          status: 'not_ready',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

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

    // Mount the Hermes live-updates WebSocket server, feeding it the container's
    // IEventSubscriber (the event broker's in-process fan-out) so published domain
    // events reach subscribed clients.
    const hermesLive = new HermesLiveUpdates({ subscriber: container.subscriber });
    hermesLive.attach(server);
    logger.info('Hermes live WebSocket attached at /api/hermes/live');

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
      await hermesLive.close();
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
