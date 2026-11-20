// GET /ready handler. It is unauthenticated, so the answer names only each component and whether
// it is reachable. The driver message can carry hosts or the database user, so even the log gets
// only the component, the error class and its code.

import type { RequestHandler } from 'express';

type ComponentCheck = () => Promise<unknown>;
type ComponentStatus = 'connected' | 'unavailable';

export interface ReadinessLogger {
  error(details: object, message: string): void;
}

export function createReadinessHandler(
  checks: Record<string, ComponentCheck>,
  logger: ReadinessLogger
): RequestHandler {
  return async (_req, res) => {
    const components: Record<string, ComponentStatus> = {};
    for (const [component, check] of Object.entries(checks)) {
      try {
        await check();
        components[component] = 'connected';
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        logger.error(
          {
            component,
            errorName: error instanceof Error ? error.name : 'Unknown',
            errorCode: typeof code === 'string' ? code : undefined,
          },
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
