import React, { useState } from 'react';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useChangePasswordMutation } from '../state/api/authApi.js';
import { useAppDispatch } from '../state/hooks.js';
import { setToken } from '../state/slices/authSlice.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { Card } from '../components/common/Card.js';
import {
  PASSWORD_CHANGED_TOAST,
  changePasswordOutcome,
  validateChangePassword,
  type ChangePasswordFailure,
  type ChangePasswordFields,
} from './changePasswordForm.js';

const EMPTY: ChangePasswordFields = { currentPassword: '', newPassword: '', repeatPassword: '' };

export const ChangePasswordCard: React.FC = () => {
  const dispatch = useAppDispatch();
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const [fields, setFields] = useState<ChangePasswordFields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof ChangePasswordFields, boolean>>>({});
  const [failure, setFailure] = useState<ChangePasswordFailure | null>(null);

  const errors = validateChangePassword(fields);
  const valid = Object.keys(errors).length === 0;
  const shown = (field: keyof ChangePasswordFields) => (touched[field] ? errors[field] : undefined);

  const update = (field: keyof ChangePasswordFields, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    setFailure((prev) => (prev?.field && field !== 'currentPassword' ? prev : null));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setTouched({ currentPassword: true, newPassword: true, repeatPassword: true });
      return;
    }
    if (isLoading) return;
    try {
      const { token } = await changePassword({
        currentPassword: fields.currentPassword,
        newPassword: fields.newPassword,
      }).unwrap();
      dispatch(setToken(token));
      setFields(EMPTY);
      setTouched({});
      setFailure(null);
      dispatch(enqueueToast({ message: PASSWORD_CHANGED_TOAST, severity: 'success' }));
    } catch (error) {
      setFailure(changePasswordOutcome(error));
    }
  };

  const currentError = shown('currentPassword') ?? (failure?.field ? failure.message : undefined);

  return (
    <Card title="Change password" sx={{ height: 'auto' }}>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          <TextField
            label="Current password"
            type="password"
            value={fields.currentPassword}
            onChange={(e) => update('currentPassword', e.target.value)}
            error={Boolean(currentError)}
            helperText={currentError}
            disabled={isLoading}
            fullWidth
            slotProps={{ htmlInput: { autoComplete: 'current-password' } }}
          />
          <TextField
            label="New password"
            type="password"
            value={fields.newPassword}
            onChange={(e) => update('newPassword', e.target.value)}
            error={Boolean(shown('newPassword'))}
            helperText={shown('newPassword')}
            disabled={isLoading}
            fullWidth
            slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
          />
          <TextField
            label="Repeat new password"
            type="password"
            value={fields.repeatPassword}
            onChange={(e) => update('repeatPassword', e.target.value)}
            error={Boolean(shown('repeatPassword'))}
            helperText={shown('repeatPassword')}
            disabled={isLoading}
            fullWidth
            slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
          />
          {failure && !failure.field && <Alert severity="error">{failure.message}</Alert>}
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button type="submit" variant="contained" disabled={!valid || isLoading}>
              Change password
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
  );
};
