import { isSessionRejected } from './AuthBootstrap';

// Regression guard: AuthBootstrap restores a stored session through /auth/me and used to log out
// on any failure. Only a rejected token may end the session: a dropped connection, a 429 or a
// 5xx says nothing about the token, and logging out on those throws away a valid session.
describe('isSessionRejected', () => {
  it.each([401, 403])('ends the session when /auth/me answers %i', (status) => {
    expect(isSessionRejected({ status, data: {} })).toBe(true);
  });

  it.each([404, 429, 500, 502, 503])('keeps the session when /auth/me answers %i', (status) => {
    expect(isSessionRejected({ status, data: {} })).toBe(false);
  });

  it.each(['FETCH_ERROR', 'TIMEOUT_ERROR', 'PARSING_ERROR'])(
    'keeps the session on a %s that never produced an HTTP status',
    (status) => {
      expect(isSessionRejected({ status, error: 'boom' })).toBe(false);
    }
  );

  it('keeps the session on a serialized error without a status', () => {
    expect(isSessionRejected({ name: 'Error', message: 'boom' })).toBe(false);
  });

  it('keeps the session when there is no error', () => {
    expect(isSessionRejected(undefined)).toBe(false);
  });
});
