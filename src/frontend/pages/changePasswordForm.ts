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
  if (status === 401) {
    return { field: 'currentPassword', message: 'Current password is incorrect' };
  }
  if (status === 429) return { message: 'Too many attempts. Try again later.' };
  return { message: 'Could not change the password. Try again.' };
}
