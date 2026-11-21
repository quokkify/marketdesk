import { WRONG_CURRENT_PASSWORD_MESSAGE, apiErrorMessage } from '../state/api/envelope.js';

export type ChangePasswordFields = {
  currentPassword: string;
  newPassword: string;
  repeatPassword: string;
};

export type ChangePasswordErrors = Partial<Record<keyof ChangePasswordFields, string>>;

export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_CHANGED_TOAST = 'Password changed. Other devices have been signed out.';

export function validateChangePassword(f: ChangePasswordFields): ChangePasswordErrors {
  const errors: ChangePasswordErrors = {};
  if (!f.currentPassword) errors.currentPassword = 'Enter your current password';
  if (f.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  } else if (f.newPassword === f.currentPassword) {
    errors.newPassword = 'Choose a different password';
  }
  if (f.repeatPassword !== f.newPassword) errors.repeatPassword = 'Passwords do not match';
  return errors;
}

export type ChangePasswordFailure = {
  field?: 'currentPassword';
  message: string;
};

export function changePasswordOutcome(error: unknown): ChangePasswordFailure {
  const status = (error as { status?: unknown } | undefined)?.status;
  if (status === 401 && apiErrorMessage(error) === WRONG_CURRENT_PASSWORD_MESSAGE) {
    return { field: 'currentPassword', message: WRONG_CURRENT_PASSWORD_MESSAGE };
  }
  if (status === 429) return { message: 'Too many attempts. Try again later.' };
  return { message: 'Could not change the password. Try again.' };
}

// A password-change answer may only touch the session that sent the request.
export function isSameSession(sentToken: string | null, currentToken: string | null): boolean {
  return sentToken !== null && sentToken === currentToken;
}
