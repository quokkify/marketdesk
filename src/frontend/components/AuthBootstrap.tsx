// Restores the authenticated session on load: when a persisted token exists but
// the user isn't hydrated yet, fetches /auth/me and the active workspace, then
// seeds the auth + workspace slices. Logs out if the token is no longer valid.
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import type { User, Workspace } from '@shared/types';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, AUTONOMY_LEVELS } from '@shared/constants';
import { useMe, useWorkspace } from '../services/hooks/index.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { setUser, logout } from '../state/slices/authSlice.js';
import { setWorkspace } from '../state/slices/workspaceSlice.js';
import { setThemeMode } from '../state/slices/uiSlice.js';
import { useGetUserPreferencesQuery } from '../state/api/settingsApi.js';
import type { WorkspaceState } from '../state/slices/workspaceSlice.js';

function toWorkspaceState(ws: Workspace): WorkspaceState {
  return {
    id: ws.id,
    name: ws.name,
    currency: ws.currency,
    timezone: ws.timezone,
    autonomyLevel: ws.autonomyLevel,
  };
}

export const AuthBootstrap: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.token);
  const user = useAppSelector((s) => s.auth.user);
  const workspaceSliceId = useAppSelector((s) => s.workspace.id);

  const me = useMe(undefined, { skip: !token || Boolean(user) });

  const workspaceId = me.data?.workspaceId ?? user?.workspaceId;
  const workspace = useWorkspace(workspaceId ?? '', { skip: !workspaceId });
  const settingsPrincipal = user?.id && workspaceId ? { userId: user.id, workspaceId } : null;
  const principalKey = settingsPrincipal
    ? `${settingsPrincipal.workspaceId}:${settingsPrincipal.userId}`
    : null;
  const themeAppliedFor = useRef<string | null>(null);
  const preferences = useGetUserPreferencesQuery(settingsPrincipal ?? skipToken);
  const savedThemeMode = preferences.currentData?.themeMode;

  // The theme public/theme-boot.js painted stays until the principal's saved theme is known. It is
  // applied once per principal, so a later refetch never overrides what the user has chosen since,
  // and signing out forgets it so the next sign-in applies its own.
  useLayoutEffect(() => {
    if (!principalKey) {
      themeAppliedFor.current = null;
      return;
    }
    if (!savedThemeMode || themeAppliedFor.current === principalKey) return;
    themeAppliedFor.current = principalKey;
    dispatch(setThemeMode(savedThemeMode));
  }, [principalKey, savedThemeMode, dispatch]);

  useEffect(() => {
    if (me.isError) dispatch(logout());
  }, [me.isError, dispatch]);

  useEffect(() => {
    if (!me.data) return;
    const hydrated: User = {
      id: me.data.id,
      email: me.data.email,
      workspaceId: me.data.workspaceId,
      createdAt: new Date().toISOString(),
    };
    dispatch(setUser(hydrated));
    if (me.data.workspaceId && me.data.workspaceId !== workspaceSliceId) {
      dispatch(
        setWorkspace({
          id: me.data.workspaceId,
          name: '',
          currency: DEFAULT_CURRENCY,
          timezone: DEFAULT_TIMEZONE,
          autonomyLevel: AUTONOMY_LEVELS.SUGGEST_ONLY,
        })
      );
    }
  }, [me.data, workspaceSliceId, dispatch]);

  useEffect(() => {
    if (workspace.data) dispatch(setWorkspace(toWorkspaceState(workspace.data)));
  }, [workspace.data, dispatch]);

  return <>{children}</>;
};

export default AuthBootstrap;
