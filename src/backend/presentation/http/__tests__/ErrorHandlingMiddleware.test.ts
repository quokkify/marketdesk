import type { NextFunction, Request, Response } from 'express';
import { createErrorHandler } from '../middleware/ErrorHandlingMiddleware';
import { NotFoundError } from '../../../domain/shared/DomainError';

function respond(err: unknown, logger: { error: jest.Mock }) {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  createErrorHandler(logger)(err, {} as Request, res as unknown as Response, jest.fn() as NextFunction);
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
      'Database constraint conflict answered with 409',
    );
  });

  it('does not log an expected domain error', () => {
    const logger = { error: jest.fn() };

    const res = respond(new NotFoundError('Product not found: p-1'), logger);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
