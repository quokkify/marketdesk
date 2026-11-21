import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createErrorHandler } from '../middleware/ErrorHandlingMiddleware';
import { createRunContextMiddleware } from '../middleware/RunContextMiddleware';
import { GuardrailViolationError, NotFoundError } from '../../../domain/shared/DomainError';
import type { IRunRecorder } from '../../../application/ports/IRunRecorder';

function respond(err: unknown, logger: { error: jest.Mock }) {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  createErrorHandler(logger)(
    err,
    {} as Request,
    res as unknown as Response,
    jest.fn() as NextFunction
  );
  return res;
}

describe('createErrorHandler', () => {
  it('logs a Postgres constraint conflict with its constraint before answering 409', () => {
    const logger = { error: jest.fn() };
    const err = Object.assign(new Error('update or delete violates foreign key constraint'), {
      code: '23503',
      constraint: 'category_correction_operations_listing_id_fkey',
      table: 'category_correction_operations',
    });

    const res = respond(err, logger);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'CONFLICT', message: 'Request conflicts with related records' },
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        err,
        pgCode: '23503',
        constraint: 'category_correction_operations_listing_id_fkey',
        table: 'category_correction_operations',
      },
      'Database constraint conflict answered with 409'
    );
  });

  it('does not log an expected domain error', () => {
    const logger = { error: jest.fn() };

    const res = respond(new NotFoundError('Product not found: p-1'), logger);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('createErrorHandler run recording', () => {
  function appWith(recorder: IRunRecorder, error: unknown) {
    const app = express();
    app.use(createRunContextMiddleware(recorder));
    app.post('/api/fail', (_req, _res, next) => next(error));
    app.use(createErrorHandler(undefined, recorder));
    return app;
  }

  function errorEvent(recorder: { record: jest.Mock }) {
    return recorder.record.mock.calls.map(([, e]) => e).find((e) => e.type === 'http.error');
  }

  it('records an expected DomainError 4xx with its code and details', async () => {
    const recorder = { enabled: true, record: jest.fn(), discard: jest.fn() };
    const err = new GuardrailViolationError('blocked', { categoryDecision: { allowed: false } });

    const res = await request(appWith(recorder, err)).post('/api/fail');

    expect(res.status).toBe(422);
    expect(errorEvent(recorder)).toMatchObject({
      type: 'http.error',
      status: 422,
      expected: true,
      error: { code: 'GUARDRAIL_VIOLATION', details: { categoryDecision: { allowed: false } } },
    });
  });

  it('records an unexpected error as not expected', async () => {
    const recorder = { enabled: true, record: jest.fn(), discard: jest.fn() };

    const res = await request(appWith(recorder, new TypeError('x is undefined'))).post('/api/fail');

    expect(res.status).toBe(500);
    expect(errorEvent(recorder)).toMatchObject({
      type: 'http.error',
      status: 500,
      expected: false,
      error: { name: 'TypeError' },
    });
  });

  it('answers normally when the recorder throws', async () => {
    const recorder = {
      enabled: true,
      record: jest.fn(() => {
        throw new Error('disk full');
      }),
      discard: jest.fn(),
    };

    const res = await request(appWith(recorder, new NotFoundError('gone'))).post('/api/fail');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
