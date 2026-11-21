// Central Express error handler. Controllers forward domain failures here via
// next(result.error); thrown/unexpected errors also land here. Maps DomainError
// subclasses to HTTP status codes and emits the §18 error envelope. Stack traces are
// never leaked in production (see toErrorBody).

import type { ErrorRequestHandler } from 'express';
import { fail, pgConstraintConflict, statusForError } from '../formatters/ResponseFormatter';
import { DomainError } from '../../../domain/shared/DomainError';
import type { IRunRecorder } from '../../../application/ports/IRunRecorder';
import { currentRun } from '../../../application/runs/runContext';
import { describeError } from '../../../application/runs/describeError';
import { ignoringFault } from '../../../application/runs/ignoringFault';

export interface ErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export function createErrorHandler(
  logger?: ErrorLogger,
  recorder?: IRunRecorder
): ErrorRequestHandler {
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
        'Database constraint conflict answered with 409'
      );
    } else if (logger && (!(err instanceof DomainError) || status >= 500)) {
      logger.error({ err }, 'Request error');
    }
    const run = currentRun();
    if (recorder?.enabled && run) {
      ignoringFault(() =>
        recorder.record(
          run.runId,
          {
            type: 'http.error',
            status,
            expected: err instanceof DomainError && status < 500,
            error: describeError(err),
          },
          { lazy: run.lazy === true && status < 500 }
        )
      );
    }
    fail(res, err, status);
  };
}
