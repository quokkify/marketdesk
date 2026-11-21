// One log line per API request (mounted on /api), written when the response finishes, so a failed
// request is visible on the server without the browser. Bodies, query strings and headers are never
// logged: they carry passwords, OAuth codes and tokens.
import type { RequestHandler, Response } from 'express';

export interface RequestLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ResponseErrorSummary {
  code: string;
  message: string;
  fields?: string[];
}

const RESPONSE_ERROR_KEY = 'responseError';
const REQUEST_LOG_MESSAGE = 'HTTP request';
const CLIENT_ERROR_STATUS = 400;
const SERVER_ERROR_STATUS = 500;

// Called by whatever answers with an error, so the request line can say what the client saw.
// Logging must never break the response, so a response without locals is left alone.
export function recordResponseError(res: Response, error: ResponseErrorSummary): void {
  if (res.locals) res.locals[RESPONSE_ERROR_KEY] = error;
}

function pathWithoutQuery(originalUrl: string): string {
  const queryStart = originalUrl.indexOf('?');
  return queryStart === -1 ? originalUrl : originalUrl.slice(0, queryStart);
}

export function createRequestLoggingMiddleware(logger: RequestLogger): RequestHandler {
  return (req, res, next) => {
    const path = pathWithoutQuery(req.originalUrl);
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const entry = {
        method: req.method,
        path,
        status,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        userId: req.user?.userId,
        workspaceId: req.user?.workspaceId,
        error: res.locals[RESPONSE_ERROR_KEY] as ResponseErrorSummary | undefined,
      };
      if (status >= SERVER_ERROR_STATUS) logger.error(entry, REQUEST_LOG_MESSAGE);
      else if (status >= CLIENT_ERROR_STATUS) logger.warn(entry, REQUEST_LOG_MESSAGE);
      else logger.info(entry, REQUEST_LOG_MESSAGE);
    });
    next();
  };
}
