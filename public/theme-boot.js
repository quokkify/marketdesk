// Applies the stored MarketDesk theme before React mounts, so a dark-mode
// first paint is not white. This is an external file rather than an inline
// script because the Content-Security-Policy only allows scripts from 'self'.
// The colours mirror palette.background.default in src/frontend/theme/themeOptions.ts.
(function () {
  'use strict';
  var BACKGROUND = { light: '#F6F7F9', dark: '#0C0D11' };
  var mode = 'system';
  try {
    var stored = window.localStorage.getItem('marketdesk.themeMode');
    if (stored === 'light' || stored === 'dark' || stored === 'system') mode = stored;
  } catch (error) {
    // Storage can be blocked (for example, by privacy settings): follow the OS.
    mode = 'system';
  }
  if (mode === 'system') {
    var prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    mode = prefersDark ? 'dark' : 'light';
  }
  var root = document.documentElement;
  root.dataset.theme = mode;
  root.style.backgroundColor = BACKGROUND[mode];
})();
