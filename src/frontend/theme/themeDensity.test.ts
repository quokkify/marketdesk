import { buildTheme } from './themeOptions';

describe('buildTheme density', () => {
  it.each([undefined, 'comfortable'] as const)(
    'keeps the default control sizes when density is %s',
    (density) => {
      const components = buildTheme('light', density).components;

      expect(components?.MuiButton?.defaultProps?.size).toBeUndefined();
      expect(components?.MuiTextField?.defaultProps?.size).toBeUndefined();
      expect(components?.MuiTableCell?.defaultProps?.size).toBeUndefined();
    }
  );

  it.each(['light', 'dark'] as const)(
    'defaults buttons, text fields and table cells to small in compact %s mode',
    (mode) => {
      const components = buildTheme(mode, 'compact').components;

      expect(components?.MuiButton?.defaultProps?.size).toBe('small');
      expect(components?.MuiTextField?.defaultProps?.size).toBe('small');
      expect(components?.MuiTableCell?.defaultProps?.size).toBe('small');
    }
  );

  it('keeps the existing button defaults in compact density', () => {
    expect(
      buildTheme('light', 'compact').components?.MuiButton?.defaultProps?.disableElevation
    ).toBe(true);
  });
});
