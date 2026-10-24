// Shared MUI theme factory for MarketDesk, built from the PRD design tokens
// (CSS custom properties of the design companion, docs/design/MarketDesk.dc.html).
// lightTheme.ts / darkTheme.ts wrap this so both modes stay in sync.

import { alpha, createTheme } from '@mui/material/styles';
import type { PaletteOptions, Shadows, Theme, ThemeOptions } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

declare module '@mui/material/styles' {
  interface Palette {
    surface2: string;
    surface3: string;
    borderStrong: string;
    textMuted: string;
  }
  interface PaletteOptions {
    surface2?: string;
    surface3?: string;
    borderStrong?: string;
    textMuted?: string;
  }
  interface PaletteColor {
    weak: string;
  }
  interface SimplePaletteColorOptions {
    weak?: string;
  }
  interface TypographyVariants {
    mono: string;
  }
  interface TypographyVariantsOptions {
    mono?: string;
  }
}

export type ThemeDensity = 'comfortable' | 'compact';

export const MONO_FONT = 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace';

const UI_FONT = 'Manrope Variable, Manrope, system-ui, -apple-system, "Segoe UI", sans-serif';

// ---- Design tokens ---------------------------------------------------------

interface DesignTokens {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  text3: string;
  primary: string;
  primaryHover: string;
  primaryWeak: string;
  onPrimary: string;
  secondary: string;
  secondaryWeak: string;
  success: string;
  successWeak: string;
  warning: string;
  warningWeak: string;
  danger: string;
  dangerWeak: string;
  info: string;
  infoWeak: string;
  sidebar: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

// The companion defines no weak tint for secondary; secondaryWeak is derived
// the way the PRD tints are (about 10% over white, about 14% over the dark bg).
const TOKENS: Record<PaletteMode, DesignTokens> = {
  light: {
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surface2: '#F2F3F6',
    surface3: '#ECEEF2',
    border: '#E7E9EF',
    borderStrong: '#DCDFE7',
    text: '#191B23',
    text2: '#5B606E',
    text3: '#8B90A0',
    primary: '#5B5BD6',
    primaryHover: '#4F4FCA',
    primaryWeak: '#EEEEFB',
    onPrimary: '#FFFFFF',
    secondary: '#C86DD7',
    secondaryWeak: '#FAF0FB',
    success: '#1C9C6B',
    successWeak: '#E6F6EE',
    warning: '#C67A12',
    warningWeak: '#FBF0DD',
    danger: '#D1435B',
    dangerWeak: '#FBE9EC',
    info: '#2B7FD4',
    infoWeak: '#E7F1FC',
    sidebar: '#FFFFFF',
    shadowSm: '0 1px 2px rgba(19,22,33,.05), 0 1px 1px rgba(19,22,33,.03)',
    shadowMd: '0 4px 14px rgba(19,22,33,.06), 0 1px 3px rgba(19,22,33,.04)',
    shadowLg: '0 18px 48px rgba(19,22,33,.12), 0 4px 12px rgba(19,22,33,.06)',
  },
  dark: {
    bg: '#0C0D11',
    surface: '#16171D',
    surface2: '#1C1E26',
    surface3: '#23262F',
    border: '#25272F',
    borderStrong: '#31343E',
    text: '#ECEEF4',
    text2: '#A4A9B8',
    text3: '#6B7080',
    primary: '#8B8BF2',
    primaryHover: '#9B9BF6',
    primaryWeak: '#1F2036',
    onPrimary: '#0C0D11',
    secondary: '#C86DD7',
    secondaryWeak: '#261A2D',
    success: '#3ECF8E',
    successWeak: '#12261E',
    warning: '#E0A94A',
    warningWeak: '#2A2113',
    danger: '#F2647D',
    dangerWeak: '#2C1620',
    info: '#5AA9F0',
    infoWeak: '#122132',
    sidebar: '#0F1014',
    shadowSm: '0 1px 2px rgba(0,0,0,.4)',
    shadowMd: '0 6px 20px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3)',
    shadowLg: '0 24px 60px rgba(0,0,0,.6)',
  },
};

// ---- Palette ---------------------------------------------------------------

function buildPalette(mode: PaletteMode, tokens: DesignTokens): PaletteOptions {
  return {
    mode,
    primary: {
      main: tokens.primary,
      dark: tokens.primaryHover,
      weak: tokens.primaryWeak,
      contrastText: tokens.onPrimary,
    },
    secondary: { main: tokens.secondary, weak: tokens.secondaryWeak, contrastText: '#FFFFFF' },
    success: { main: tokens.success, weak: tokens.successWeak },
    warning: { main: tokens.warning, weak: tokens.warningWeak },
    error: { main: tokens.danger, weak: tokens.dangerWeak },
    info: { main: tokens.info, weak: tokens.infoWeak },
    background: { default: tokens.bg, paper: tokens.surface },
    text: { primary: tokens.text, secondary: tokens.text2 },
    divider: tokens.border,
    surface2: tokens.surface2,
    surface3: tokens.surface3,
    borderStrong: tokens.borderStrong,
    textMuted: tokens.text3,
  };
}

// ---- Shadows ---------------------------------------------------------------

// Elevation 1-2 = sm (cards, switch thumbs), 3-7 = md (snackbars),
// 8 and above = lg (menus, popovers, drawers, dialogs).
function buildShadows(tokens: DesignTokens): Shadows {
  return Array.from({ length: 25 }, (_, elevation) => {
    if (elevation === 0) return 'none';
    if (elevation <= 2) return tokens.shadowSm;
    if (elevation <= 7) return tokens.shadowMd;
    return tokens.shadowLg;
  }) as Shadows;
}

// ---- Typography ------------------------------------------------------------

const TYPOGRAPHY: ThemeOptions['typography'] = {
  fontFamily: UI_FONT,
  mono: MONO_FONT,
  h1: { fontWeight: 800, fontSize: '2.25rem', letterSpacing: '-0.03em' },
  h2: { fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.02em' },
  h3: { fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em' },
  h4: { fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' },
  h5: { fontWeight: 800, fontSize: '1.125rem', letterSpacing: '-0.01em' },
  h6: { fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' },
  subtitle1: { fontWeight: 600 },
  subtitle2: { fontWeight: 700, fontSize: '0.8125rem' },
  overline: {
    fontWeight: 700,
    fontSize: '0.65625rem',
    letterSpacing: '0.08em',
    lineHeight: 1.6,
  },
  button: { fontWeight: 700, textTransform: 'none' },
};

// ---- Components ------------------------------------------------------------

function buildComponents(tokens: DesignTokens): ThemeOptions['components'] {
  const primaryGlow = `0 4px 12px ${alpha(tokens.primary, 0.28)}`;

  return {
    MuiCssBaseline: {
      styleOverrides: {
        '::-webkit-scrollbar': { width: 11, height: 11 },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: tokens.borderStrong,
          borderRadius: 8,
          border: `3px solid ${tokens.bg}`,
        },
        '::-webkit-scrollbar-thumb:hover': { backgroundColor: tokens.text3 },
        '::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 700,
          variants: [
            {
              props: { variant: 'contained', color: 'primary' },
              style: { boxShadow: primaryGlow, '&:hover': { boxShadow: primaryGlow } },
            },
          ],
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 600 } } },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: `1px solid ${tokens.border}`,
          boxShadow: tokens.shadowSm,
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${tokens.border}`, fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'default' },
      styleOverrides: {
        root: {
          backgroundColor: tokens.surface,
          color: tokens.text,
          borderBottom: `1px solid ${tokens.border}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: tokens.sidebar,
          borderRight: `1px solid ${tokens.border}`,
          backgroundImage: 'none',
        },
      },
    },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
  };
}

// ---- Theme -----------------------------------------------------------------

// Callers may pass the user's density; the PRD tokens are the same in both.
export function buildTheme(mode: PaletteMode, _density: ThemeDensity = 'comfortable'): Theme {
  const tokens = TOKENS[mode];
  const options: ThemeOptions = {
    palette: buildPalette(mode, tokens),
    shape: { borderRadius: 10 },
    shadows: buildShadows(tokens),
    typography: TYPOGRAPHY,
    components: buildComponents(tokens),
  };
  return createTheme(options);
}
