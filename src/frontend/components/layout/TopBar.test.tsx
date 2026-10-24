import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import { TopBar, resolveShortcutHint, resolveTopBarRoute } from './TopBar.js';
import { APP_ROUTE_PATHS, NAV_ITEMS } from '../../utils/constants.js';

const state = { ui: { themeMode: 'light' } };

jest.mock('../../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (selector: (value: typeof state) => unknown) => selector(state),
}));

jest.mock('./CommandPalette.js', () => ({
  CommandPalette: () => null,
  isCommandPaletteShortcut: () => false,
}));

describe('canonical MarketDesk shell contract', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/products', 'Products'],
    ['/analytics', 'Analytics'],
    ['/hermes', 'Hermes AI'],
    ['/marketplaces', 'Marketplaces'],
    ['/settings', 'Settings'],
  ])('maps %s to the contextual title %s', (path, title) => {
    expect(resolveTopBarRoute(path).title).toBe(title);
  });

  it('uses a stable product-detail identity for dynamic product routes', () => {
    expect(resolveTopBarRoute('/products/product-123')).toEqual({
      title: 'Product detail',
      subtitle: 'Listing status, pricing, and marketplace activity.',
    });
  });

  it('keeps Listings routable but out of primary PRD navigation', () => {
    expect(APP_ROUTE_PATHS.listings).toBe('/listings');
    expect(NAV_ITEMS.map(({ path }) => path)).toEqual([
      '/',
      '/products',
      '/analytics',
      '/hermes',
      '/marketplaces',
      '/settings',
    ]);
  });

  it('falls back to the product brand for unknown routes', () => {
    expect(resolveTopBarRoute('/unexpected')).toEqual({
      title: 'MarketDesk',
      subtitle: 'Marketplace operations workspace.',
    });
  });
});

describe('command palette shortcut hint', () => {
  it.each([
    ['MacIntel', '⌘K'],
    ['iPhone', '⌘K'],
    ['iPad', '⌘K'],
    ['Win32', 'Ctrl K'],
    ['Linux x86_64', 'Ctrl K'],
    ['', 'Ctrl K'],
  ])('shows the %s shortcut as %s', (platform, hint) => {
    expect(resolveShortcutHint(platform)).toBe(hint);
  });
});

describe('PRD top bar', () => {
  // Emotion emits each style once per render tree, so every assertion reads
  // the same first render.
  const html = renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter initialEntries={['/products']}>
        <TopBar />
      </MemoryRouter>
    </ThemeProvider>
  );

  it('renders the theme and notification controls as bordered 36px squares', () => {
    expect(html).toMatch(/<button(?=[^>]*aria-label="Toggle theme")[^>]*>/);
    expect(html).toContain('width:36px;height:36px');
    expect(html).toContain('border-radius:10px');
    expect(html).toContain('border:1px solid');
    expect(html).toContain('border-color:#E7E9EF');
  });

  it('keeps notifications visibly unavailable', () => {
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*aria-label="Notifications unavailable")[^>]*>/
    );
  });

  it('offers the command palette with a keyboard shortcut hint', () => {
    expect(html).toContain('aria-label="Search products, listings, and Hermes events"');
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).toMatch(/<kbd[^>]*>(⌘K|Ctrl K)<\/kbd>/);
  });

  it('shows the route title with the muted subtitle', () => {
    expect(html).toMatch(/<h1[^>]*>Products<\/h1>/);
    expect(html).toContain('Manage your catalogue across every marketplace.');
  });
});
