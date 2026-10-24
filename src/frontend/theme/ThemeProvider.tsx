// App theme provider: selects light/dark theme from uiSlice and applies
// MUI's ThemeProvider + CssBaseline. Must be rendered inside the Redux Provider.
import React from 'react';
import { ThemeProvider as MuiThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { useAppSelector } from '../state/hooks.js';
import { resolveThemeMode } from '../state/slices/uiSlice.js';
import { lightTheme } from './lightTheme.js';
import { darkTheme } from './darkTheme.js';

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useAppSelector((state) => state.ui.themeMode);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const resolvedMode = resolveThemeMode(mode, prefersDark);
  const theme = resolvedMode === 'dark' ? darkTheme : lightTheme;

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
