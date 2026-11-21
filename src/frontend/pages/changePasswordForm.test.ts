import {
  changePasswordOutcome,
  isSameSession,
  validateChangePassword,
} from './changePasswordForm';

const current = 'c'.repeat(9);
const next = 'n'.repeat(9);
const valid = { currentPassword: current, newPassword: next, repeatPassword: next };

describe('validateChangePassword', () => {
  it('accepts a valid set', () => {
    expect(validateChangePassword(valid)).toEqual({});
  });

  it('asks for the current password', () => {
    expect(validateChangePassword({ ...valid, currentPassword: '' })).toEqual({
      currentPassword: 'Enter your current password',
    });
  });

  it('requires at least 8 characters', () => {
    const short = 'x'.repeat(7);
    expect(validateChangePassword({ ...valid, newPassword: short, repeatPassword: short })).toEqual(
      { newPassword: 'Use at least 8 characters' }
    );
    expect(
      validateChangePassword({
        ...valid,
        newPassword: 'x'.repeat(8),
        repeatPassword: 'x'.repeat(8),
      })
    ).toEqual({});
  });

  it('requires the repeat to match', () => {
    expect(validateChangePassword({ ...valid, repeatPassword: 'm'.repeat(9) })).toEqual({
      repeatPassword: 'Passwords do not match',
    });
  });

  it('requires a different password', () => {
    expect(
      validateChangePassword({
        currentPassword: current,
        newPassword: current,
        repeatPassword: current,
      })
    ).toEqual({ newPassword: 'Choose a different password' });
  });
});

describe('changePasswordOutcome', () => {
  it('maps a wrong current password to the field', () => {
    const error = {
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'Current password is incorrect' } },
    };
    expect(changePasswordOutcome(error)).toEqual({
      field: 'currentPassword',
      message: 'Current password is incorrect',
    });
  });

  // Regression guard: any 401 used to read as "wrong password", hiding a revoked session.
  it('does not blame the password for a 401 with another message', () => {
    const error = {
      status: 401,
      data: { error: { code: 'UNAUTHORIZED', message: 'Session has been revoked' } },
    };
    expect(changePasswordOutcome(error)).toEqual({
      message: 'Could not change the password. Try again.',
    });
    expect(changePasswordOutcome({ status: 401 })).toEqual({
      message: 'Could not change the password. Try again.',
    });
  });

  it('maps rate limiting to a form message', () => {
    expect(changePasswordOutcome({ status: 429 })).toEqual({
      message: 'Too many attempts. Try again later.',
    });
  });

  it('falls back to a generic message for anything else', () => {
    const generic = { message: 'Could not change the password. Try again.' };
    expect(changePasswordOutcome({ status: 500 })).toEqual(generic);
    expect(changePasswordOutcome(undefined)).toEqual(generic);
  });
});

describe('isSameSession', () => {
  it('holds only while the token sent with the request is still the current one', () => {
    expect(isSameSession('t1', 't1')).toBe(true);
    expect(isSameSession('t1', 't2')).toBe(false);
    expect(isSameSession('t1', null)).toBe(false);
    expect(isSameSession(null, null)).toBe(false);
  });
});
