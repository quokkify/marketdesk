import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Card, Chip, IconButton, OutlinedInput } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { buildTheme, MONO_FONT } from './themeOptions';

// PRD design tokens: the CSS custom properties of the design companion
// (docs/design/MarketDesk.dc.html), restated here as an independent oracle.
const PRD = {
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
    success: '#1C9C6B',
    successWeak: '#E6F6EE',
    warning: '#C67A12',
    warningWeak: '#FBF0DD',
    danger: '#D1435B',
    dangerWeak: '#FBE9EC',
    info: '#2B7FD4',
    infoWeak: '#E7F1FC',
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
    success: '#3ECF8E',
    successWeak: '#12261E',
    warning: '#E0A94A',
    warningWeak: '#2A2113',
    danger: '#F2647D',
    dangerWeak: '#2C1620',
    info: '#5AA9F0',
    infoWeak: '#122132',
    shadowSm: '0 1px 2px rgba(0,0,0,.4)',
    shadowMd: '0 6px 20px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3)',
    shadowLg: '0 24px 60px rgba(0,0,0,.6)',
  },
} as const;

function render(theme: Theme, node: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(ThemeProvider, { theme }, node));
}

// Emotion keeps MUI's default declaration and appends theme overrides to the
// same rule, so the effective radius is the last one in the root rule.
function effectiveRadius(html: string, rootClass: string): string | undefined {
  const rule = html.match(new RegExp(`\\.css-[\\w-]*${rootClass}\\{([^}]*)\\}`));
  const radii = [...(rule?.[1] ?? '').matchAll(/border-radius:([^;]+);/g)].map((m) => m[1]);
  return radii[radii.length - 1];
}

describe.each(['light', 'dark'] as const)('%s PRD theme', (mode) => {
  const theme = buildTheme(mode);
  const tokens = PRD[mode];

  it('maps background, surfaces, borders and text to the PRD tokens', () => {
    const { palette } = theme;
    expect(palette.mode).toBe(mode);
    expect(palette.background.default).toBe(tokens.bg);
    expect(palette.background.paper).toBe(tokens.surface);
    expect(palette.surface2).toBe(tokens.surface2);
    expect(palette.surface3).toBe(tokens.surface3);
    expect(palette.divider).toBe(tokens.border);
    expect(palette.borderStrong).toBe(tokens.borderStrong);
    expect(palette.text.primary).toBe(tokens.text);
    expect(palette.text.secondary).toBe(tokens.text2);
    expect(palette.textMuted).toBe(tokens.text3);
  });

  it('maps primary and semantic colours together with their weak tints', () => {
    const { palette } = theme;
    expect(palette.primary.main).toBe(tokens.primary);
    expect(palette.primary.dark).toBe(tokens.primaryHover);
    expect(palette.primary.weak).toBe(tokens.primaryWeak);
    expect(palette.success.main).toBe(tokens.success);
    expect(palette.success.weak).toBe(tokens.successWeak);
    expect(palette.warning.main).toBe(tokens.warning);
    expect(palette.warning.weak).toBe(tokens.warningWeak);
    expect(palette.error.main).toBe(tokens.danger);
    expect(palette.error.weak).toBe(tokens.dangerWeak);
    expect(palette.info.main).toBe(tokens.info);
    expect(palette.info.weak).toBe(tokens.infoWeak);
    expect(palette.secondary.weak).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('exposes the PRD shadow scale through theme.shadows', () => {
    expect(theme.shadows).toHaveLength(25);
    expect(theme.shadows[0]).toBe('none');
    expect(theme.shadows[1]).toBe(tokens.shadowSm);
    expect(theme.shadows[3]).toBe(tokens.shadowMd);
    expect(theme.shadows[8]).toBe(tokens.shadowLg);
    expect(theme.shadows[24]).toBe(tokens.shadowLg);
  });

  it('keeps the PRD tokens in compact density', () => {
    const compact = buildTheme(mode, 'compact');
    // JSON drops the per-instance palette helpers (augmentColor, getContrastText).
    expect(JSON.stringify(compact.palette)).toBe(JSON.stringify(theme.palette));
    expect(compact.shadows).toEqual(theme.shadows);
    expect(compact.shape).toEqual(theme.shape);
    expect(compact.typography.fontFamily).toBe(theme.typography.fontFamily);
    expect(compact.typography.mono).toBe(theme.typography.mono);
  });
});

describe('PRD typography', () => {
  const theme = buildTheme('light');

  it('uses Manrope for interface text', () => {
    expect(theme.typography.fontFamily).toMatch(/^Manrope/);
  });

  it('exposes JetBrains Mono for SKUs and keys', () => {
    expect(MONO_FONT).toBe('JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace');
    expect(theme.typography.mono).toBe(MONO_FONT);
  });
});

describe('PRD component radii', () => {
  const theme = buildTheme('light');

  it('uses radius 10 for buttons and inputs', () => {
    expect(theme.shape.borderRadius).toBe(10);
    const button = render(theme, React.createElement(Button, null, 'Save'));
    const input = render(theme, React.createElement(OutlinedInput, { value: '' }));
    expect(effectiveRadius(button, 'MuiButton-root')).toBe('10px');
    expect(effectiveRadius(input, 'MuiOutlinedInput-root')).toBe('10px');
  });

  it('uses radius 7 for chips and 16 for cards', () => {
    const chip = render(theme, React.createElement(Chip, { label: 'Draft' }));
    const card = render(theme, React.createElement(Card, null, 'Body'));
    expect(effectiveRadius(chip, 'MuiChip-root')).toBe('7px');
    expect(effectiveRadius(card, 'MuiCard-root')).toBe('16px');
  });

  it('renders icon buttons as rounded squares', () => {
    const html = render(theme, React.createElement(IconButton, { 'aria-label': 'Menu' }, 'x'));
    expect(effectiveRadius(html, 'MuiIconButton-root')).toBe('10px');
  });
});
