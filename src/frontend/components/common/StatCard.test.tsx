import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import { StatCard } from './StatCard';

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>);
}

describe('StatCard', () => {
  it('shows the value with tabular numerals and the icon on a soft tile', () => {
    const html = render(
      <StatCard label="Profit" value="52 940 zł" tone="success" icon={<svg data-icon="profit" />} />
    );
    expect(html).toContain('Profit');
    expect(html).toContain('52 940 zł');
    expect(html).toContain('font-variant-numeric:tabular-nums');
    expect(html).toMatch(/data-testid="stat-card-icon"[^>]*>[^]*data-icon="profit"/);
    expect(html).toContain('background-color:#E6F6EE');
    expect(html.indexOf('Profit')).toBeLessThan(html.indexOf('data-icon="profit"'));
  });

  it('renders a positive delta as a success chip with its comparison label', () => {
    const html = render(<StatCard label="Revenue" value="148 230 zł" deltaPct={12.4} />);
    expect(html).toMatch(/data-testid="stat-card-delta"/);
    expect(html).toContain('+12.4%');
    expect(html).toContain('vs last month');
    expect(html).toContain('color:#1C9C6B');
  });

  it('renders a negative delta as an error chip', () => {
    const html = render(
      <StatCard label="Views" value="4 210" deltaPct={-3.14} deltaLabel="vs previous period" />
    );
    expect(html).toContain('-3.1%');
    expect(html).toContain('vs previous period');
    expect(html).toContain('background-color:#FBE9EC');
  });

  it('omits the delta chip when there is no comparable period', () => {
    const html = render(<StatCard label="Active listings" value="0" deltaPct={Number.NaN} />);
    expect(html).not.toContain('data-testid="stat-card-delta"');
    expect(html).not.toContain('vs last month');
  });

  it('keeps the label visible while loading', () => {
    const html = render(<StatCard label="Revenue" value="148 230 zł" loading />);
    expect(html).toContain('Revenue');
    expect(html).not.toContain('148 230 zł');
    expect(html).toContain('MuiSkeleton');
  });
});
