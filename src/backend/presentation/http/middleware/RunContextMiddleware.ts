// Opens a run for every /api request: sets X-Run-Id and records the request's start
// and end. The run id is always generated here, never read from the request. A
// recorder fault is swallowed so it cannot change a response.

import type { RequestHandler } from 'express';
import type { IRunRecorder } from '../../../application/ports/IRunRecorder';
import { ignoringFault } from '../../../application/runs/ignoringFault';
import { newRunId, runInContext } from '../../../application/runs/runContext';

const LAZY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ABORTED_STATUS = 499;

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

// Wildcards and optional segments make the route's segment count differ from the request's.
const DYNAMIC_ROUTE_SYNTAX = /[*{}()?+]/;

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

// req.baseUrl is already restored when a request leaves a mounted router through
// next(err), so the mount prefix is taken from the request path instead: its leading
// segments that the route path does not cover.
export function routePattern(requestPath: string, routePath: unknown): string {
  const requestSegments = segments(requestPath);
  const fallback = `/${requestSegments.join('/')}`;
  if (typeof routePath !== 'string' || DYNAMIC_ROUTE_SYNTAX.test(routePath)) {
    return fallback;
  }
  const routeSegments = segments(routePath);
  if (routeSegments.length === 0 || routeSegments.length > requestSegments.length) {
    return fallback;
  }
  const prefix = requestSegments.slice(0, requestSegments.length - routeSegments.length);
  return `/${[...prefix, ...routeSegments].join('/')}`;
}

export function createRunContextMiddleware(recorder: IRunRecorder): RequestHandler {
  return (req, res, next) => {
    if (!isApiPath(req.path)) {
      next();
      return;
    }
    const runId = newRunId();
    const lazy = LAZY_METHODS.has(req.method);
    const startedAt = Date.now();
    const method = req.method;
    const path = req.path;
    res.setHeader('X-Run-Id', runId);

    if (recorder.enabled) {
      ignoringFault(() =>
        recorder.record(runId, { type: 'run.start', kind: 'http', method, path }, { lazy })
      );

      let ended = false;
      const end = (status: number, aborted: boolean) => {
        if (ended) {
          return;
        }
        ended = true;
        const keepLazy = lazy && status < 500;
        ignoringFault(() =>
          recorder.record(
            runId,
            {
              type: 'http.end',
              method,
              route: req.route ? routePattern(path, req.route.path) : path,
              status,
              durationMs: Math.round(Date.now() - startedAt),
              ...(aborted ? { aborted: true } : {}),
            },
            { lazy: keepLazy }
          )
        );
        if (keepLazy) {
          ignoringFault(() => recorder.discard(runId));
        }
      };
      res.on('finish', () => end(res.statusCode, false));
      res.on('close', () => end(ABORTED_STATUS, true));
    }

    runInContext({ runId, kind: 'http', lazy }, next);
  };
}
