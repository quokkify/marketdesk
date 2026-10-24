// App theme provider: selects light/dark theme from uiSlice and the compact/comfortable
// density from the signed-in user's preferences, then applies MUI's ThemeProvider +
// CssBaseline. Must be rendered inside the Redux Provider.
import React, { useMemo } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { ThemeProvider as MuiThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { useAppSelector } from '../state/hooks.js';
import { resolveThemeMode } from '../state/slices/uiSlice.js';
import { useGetUserPreferencesQuery } from '../state/api/settingsApi.js';
import { buildTheme, type ThemeDensity } from './themeOptions.js';

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useAppSelector((state) => state.ui.themeMode);
  const workspaceId = useAppSelector((state) => state.workspace.id);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const preferences = useGetUserPreferencesQuery(
    workspaceId && userId ? { workspaceId, userId } : skipToken
  );
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const resolvedMode = resolveThemeMode(mode, prefersDark);
  const density: ThemeDensity =
    preferences.currentData?.density === 'compact' ? 'compact' : 'comfortable';
  const theme = useMemo(() => buildTheme(resolvedMode, density), [resolvedMode, density]);

  // public/theme-boot.js set <html data-theme> and its background before React
  // mounted; keep both in step when the mode changes.
  const background = theme.palette.background.default;
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedMode;
    root.style.backgroundColor = background;
  }, [resolvedMode, background]);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  );
};

export default AppThemeProvider;
