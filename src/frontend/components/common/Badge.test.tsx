import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import type { HermesEventStatus, ListingStatus, ProductStatus } from '@shared/types';
import { darkTheme } from '../../theme/darkTheme';
import { lightTheme } from '../../theme/lightTheme';
import { Badge, HermesStatusBadge, ListingStatusBadge, ProductStatusBadge } from './Badge';

function render(node: React.ReactNode, theme = lightTheme) {
  return renderToStaticMarkup(<ThemeProvider theme={theme}>{node}</ThemeProvider>);
}

function chipClass(html: string): string | undefined {
  return html.match(/class="(MuiChip-root[^"]*)"/)?.[1];
}

const DOT = /<span [^>]*aria-hidden="true"[^>]*><\/span>/;

describe('status badges', () => {
  it('renders a tone on its weak tint with a status dot', () => {
    const html = render(<ProductStatusBadge status="active" />);
    expect(html).toContain('Active');
    expect(html).toContain('background-color:#E6F6EE');
    expect(html).toContain('color:#1C9C6B');
    expect(html).toMatch(DOT);
  });

  it('uses the dark weak tint in dark mode', () => {
    const html = render(<ListingStatusBadge status="error" />, darkTheme);
    expect(html).toContain('Error');
    expect(html).toContain('background-color:#2C1620');
    expect(html).toContain('color:#F2647D');
  });

  it('shows neutral states on the muted surface and falls back to it for unknown values', () => {
    const draft = render(<ProductStatusBadge status="draft" />);
    expect(draft).toContain('background-color:#ECEEF2');
    expect(draft).toContain('color:#5B606E');

    const unknown = render(<ProductStatusBadge status={'archived_by_admin' as ProductStatus} />);
    expect(unknown).toContain('Archived by admin');
    expect(chipClass(unknown)).toBe(chipClass(draft));
  });

  it('never resolves labels from object prototype keys', () => {
    const html = render(<HermesStatusBadge status={'constructor' as HermesEventStatus} />);
    expect(html).toContain('>Constructor<');
  });

  it('labels a missing value as Unknown instead of crashing', () => {
    const html = render(<ListingStatusBadge status={undefined as unknown as ListingStatus} />);
    expect(html).toContain('Unknown');
  });

  it('replaces the dot with an icon when one is supplied', () => {
    const html = render(<Badge label="Sandbox" color="info" icon={<svg data-icon="sandbox" />} />);
    expect(html).toContain('Sandbox');
    expect(html).toContain('data-icon="sandbox"');
    expect(html).not.toMatch(DOT);
  });
});
