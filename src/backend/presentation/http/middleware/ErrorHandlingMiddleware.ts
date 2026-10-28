// Central Express error handler. Controllers forward domain failures here via
// next(result.error); thrown/unexpected errors also land here. Maps DomainError
// subclasses to HTTP status codes and emits the §18 error envelope. Stack traces are
// never leaked in production (see toErrorBody).

import type { ErrorRequestHandler } from 'express';
import { pgConstraintConflict, statusForError, toErrorBody } from '../formatters/ResponseFormatter';
import { DomainError } from '../../../domain/shared/DomainError';

export interface ErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export function createErrorHandler(logger?: ErrorLogger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    const status = statusForError(err);
    const conflict = pgConstraintConflict(err);
    // Only log unexpected (non-domain) errors and 5xx as errors; domain errors are
    // expected control flow. A constraint conflict reaches the client as a generic
    // 409, so the log names the constraint for diagnosis.
    if (logger && conflict) {
      logger.error(
        { err, pgCode: conflict.code, constraint: conflict.constraint, table: conflict.table },
        'Database constraint conflict answered with 409',
      );
    } else if (logger && (!(err instanceof DomainError) || status >= 500)) {
      logger.error({ err }, 'Request error');
    }
    res.status(status).json({ success: false, error: toErrorBody(err) });
  };
}
