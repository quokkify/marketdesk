import { statusForError, toErrorBody } from '../formatters/ResponseFormatter';

function driverError(code: string): Error {
  // The driver message names the constraint and echoes row values.
  return Object.assign(new Error('violates constraint "secret_name": (id)=(42)'), { code });
}

describe('ResponseFormatter Postgres constraint violations', () => {
  it.each([
    ['23505', 'Resource already exists'],
    ['23503', 'Request conflicts with related records'],
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
});
