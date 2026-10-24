import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import { textOf } from '../../testkit/staticMarkup';
import { SIDEBAR_WIDTH } from '../../utils/constants';
import { Sidebar, isPrimaryNavActive, resolveSidebarResponsiveMode } from './Sidebar';

const state = {
  ui: { sidebarCollapsed: false, sidebarMobileOpen: false },
  workspace: { name: 'Demo shop' },
  auth: { user: { email: 'seller@example.test' } },
};

jest.mock('../../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (selector: (value: typeof state) => unknown) => selector(state),
}));

jest.mock('../../state/api/index.js', () => ({
  useGetHermesEventsQuery: () => ({ currentData: { total: 3 } }),
}));

// Layout geometry is intentionally tested as a contract because MUI's default
// breakpoints (md=900) do not match the product requirement.
describe('MarketDesk sidebar shell contract', () => {
  it.each([
    [0, 'mobile'],
    [767, 'mobile'],
    [768, 'medium'],
    [1199, 'medium'],
    [1200, 'desktop'],
    [1920, 'desktop'],
  ] as const)('uses the expected responsive mode at %ipx', (width, mode) => {
    expect(resolveSidebarResponsiveMode(width)).toBe(mode);
  });

  it('keeps Products active for catalogue, wizard query, and detail routes', () => {
    expect(isPrimaryNavActive('/products', '/products')).toBe(true);
    expect(isPrimaryNavActive('/products/new', '/products')).toBe(true);
    expect(isPrimaryNavActive('/products/product-123', '/products')).toBe(true);
  });

  it('does not mark Dashboard active for unrelated routes', () => {
    expect(isPrimaryNavActive('/', '/')).toBe(true);
    expect(isPrimaryNavActive('/products', '/')).toBe(false);
  });
});

describe('expanded desktop sidebar (PRD shell)', () => {
  // Emotion emits each style once per render tree, so every assertion reads
  // the same first render.
  const html = renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>
    </ThemeProvider>
  );
  const text = textOf(html);

  it('is 250px wide', () => {
    expect(SIDEBAR_WIDTH).toBe(250);
    expect(html).toContain('width:250px');
  });

  it('shows the canonical mark, the product name and the eyebrow beneath it', () => {
    expect(html).toMatch(/<img [^>]*src="\/marketdesk-mark.svg"/);
    expect(text.indexOf('MarketDesk')).toBeGreaterThan(-1);
    expect(text.indexOf('MarketDesk')).toBeLessThan(text.indexOf('Marketplace OS'));
  });

  it('labels the primary navigation with a Menu eyebrow', () => {
    expect(text.indexOf('Menu')).toBeGreaterThan(text.indexOf('Marketplace OS'));
    expect(text.indexOf('Menu')).toBeLessThan(text.indexOf('Dashboard'));
  });

  it('marks the active route on the primary-weak tint', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(
      /aria-current="page"[^>]*aria-label="Dashboard"|aria-label="Dashboard"[^>]*aria-current="page"/
    );
    expect(html).toContain('background-color:#EEEEFB');
    expect(html).toContain('color:#5B5BD6');
  });

  it('shows pending Hermes reviews as a danger pill', () => {
    expect(html).toContain('aria-label="Hermes AI, 3 pending reviews"');
    expect(text).toMatch(/\|Hermes AI\|3\|/);
    expect(html).toContain('background-color:#FBE9EC');
    expect(html).toContain('color:#D1435B');
  });

  it('keeps menu items at their natural height', () => {
    // Regression guard: ListItemButton grows by default, which stretched every
    // item down the full sidebar column. Emotion appends the sx override to the
    // same rule, so the effective value is the last flex-grow declaration.
    const itemClasses = new Set(
      [...html.matchAll(/class="[^"]*MuiListItemButton-root[^"]*"/g)].map(
        (match) => match[0].match(/css-[\w-]+/)?.[0]
      )
    );
    expect(itemClasses.size).toBeGreaterThan(0);
    for (const itemClass of itemClasses) {
      const rule = html.match(new RegExp(`\\.${itemClass}\\{([^}]*)\\}`))?.[1] ?? '';
      const grows = [...rule.matchAll(/flex-grow:([^;]+);/g)].map((match) => match[1]);
      expect(grows[grows.length - 1]).toBe('0');
    }
  });

  it('keeps settings and the account card at the bottom', () => {
    expect(text.indexOf('Settings')).toBeGreaterThan(text.indexOf('Marketplaces'));
    expect(text.indexOf('Demo shop')).toBeGreaterThan(text.indexOf('Settings'));
    expect(text).toContain('seller@example.test');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('background-color:#F2F3F6');
  });
});
