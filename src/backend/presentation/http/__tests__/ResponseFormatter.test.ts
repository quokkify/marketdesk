import { pgConstraintConflict, statusForError, toErrorBody } from '../formatters/ResponseFormatter';

function driverError(code: string, details: Record<string, unknown> = {}): Error {
  // The driver message names the constraint and echoes row values.
  return Object.assign(new Error('violates constraint "secret_name": (id)=(42)'), { code, ...details });
}

describe('ResponseFormatter Postgres constraint violations', () => {
  it.each([
    ['23505', 'Resource already exists'],
    ['23503', 'Request conflicts with related records'],
    // PostgreSQL 18 reports an ON DELETE RESTRICT violation as restrict_violation.
    ['23001', 'Request conflicts with related records'],
  ])('maps pg %s to 409 CONFLICT without the driver message', (code, message) => {
    const error = driverError(code);

    expect(statusForError(error)).toBe(409);
    expect(toErrorBody(error)).toEqual({ code: 'CONFLICT', message });
  });

  it.each(['40P01', 'constructor'])('keeps other error code %s a 500', (code) => {
    const error = driverError(code);

    expect(statusForError(error)).toBe(500);
    expect(toErrorBody(error).code).toBe('INTERNAL_ERROR');
  });

  it('reads the constraint and table of a conflict for the server log', () => {
    expect(
      pgConstraintConflict(driverError('23503', { constraint: 'listings_product_id_fkey', table: 'listings' })),
    ).toEqual({
      code: '23503',
      constraint: 'listings_product_id_fkey',
      table: 'listings',
      message: 'Request conflicts with related records',
    });
    expect(pgConstraintConflict(driverError('23505'))).toMatchObject({ constraint: null, table: null });
    expect(pgConstraintConflict(driverError('40P01'))).toBeNull();
  });
});
