// GET /ready handler. It is unauthenticated, so the answer names only each component and whether
// it is reachable; the driver error, which can carry hosts, users or SQL state, goes to the log
// with configured secrets redacted.

import type { RequestHandler } from 'express';
import { safeErrorDetails } from '../../config/safeErrorDetails';

type ComponentCheck = () => Promise<unknown>;
type ComponentStatus = 'connected' | 'unavailable';

export interface ReadinessLogger {
  error(details: object, message: string): void;
}

export function createReadinessHandler(
  checks: Record<string, ComponentCheck>,
  logger: ReadinessLogger,
  sensitiveValues: readonly (string | undefined)[] = []
): RequestHandler {
  return async (_req, res) => {
    const components: Record<string, ComponentStatus> = {};
    for (const [component, check] of Object.entries(checks)) {
      try {
        await check();
        components[component] = 'connected';
      } catch (error) {
        logger.error(
          { component, error: safeErrorDetails(error, sensitiveValues) },
          'Readiness check failed'
        );
        components[component] = 'unavailable';
      }
    }
    const ready = Object.values(components).every((status) => status === 'connected');
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      ...components,
      timestamp: new Date().toISOString(),
    });
  };
}
