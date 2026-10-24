import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import { AppShell } from './AppShell';

jest.mock('./TopBar.js', () => ({ TopBar: () => <header>TOPBAR</header> }));
jest.mock('./Sidebar.js', () => ({ Sidebar: () => <nav>SIDEBAR</nav> }));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  Outlet: () => <p>OUTLET</p>,
  useLocation: () => ({ key: 'visit-1' }),
}));

jest.mock('../common/RouteErrorBoundary.js', () => ({
  RouteErrorBoundary: ({ resetKey, children }: { resetKey: string; children: React.ReactNode }) => (
    <section data-boundary={resetKey}>{children}</section>
  ),
}));

describe('app shell', () => {
  const html = renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <AppShell />
    </ThemeProvider>
  );
  const insideBoundary = html.match(/<section data-boundary="([^"]*)">(.*?)<\/section>/s);

  it('guards the routed page with an error boundary that resets on navigation', () => {
    expect(insideBoundary?.[1]).toBe('visit-1');
    expect(insideBoundary?.[2]).toContain('OUTLET');
  });

  it('keeps the sidebar and top bar outside the boundary so they survive a page crash', () => {
    expect(html).toContain('SIDEBAR');
    expect(html).toContain('TOPBAR');
    expect(insideBoundary?.[2]).not.toContain('SIDEBAR');
    expect(insideBoundary?.[2]).not.toContain('TOPBAR');
  });
});
