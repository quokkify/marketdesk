import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { alpha, createTheme, darken } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import {
  MARKETPLACE_BRAND_COLORS,
  MARKETPLACE_KEY_LIST,
  MARKETPLACE_NAMES,
  MARKETPLACE_SHORT,
} from '@shared/constants';
import { MarketplaceBrandChip } from './MarketplaceBrandChip';

type ChipStyles = Record<string, unknown>;
type ChipElement = React.ReactElement<{ sx: (theme: Theme) => ChipStyles }>;

function chipStyles(
  props: React.ComponentProps<typeof MarketplaceBrandChip>,
  mode: 'light' | 'dark',
): ChipStyles {
  const element = MarketplaceBrandChip(props) as ChipElement;
  return element.props.sx(createTheme({ palette: { mode } }));
}

describe('MarketplaceBrandChip', () => {
  it('defines the PRD brand colour and two-letter code for every channel', () => {
    expect(MARKETPLACE_BRAND_COLORS).toEqual({
      olx: '#12B6AB',
      allegro: '#FF5A00',
      vinted: '#09B1BA',
      facebook: '#1877F2',
      ebay: '#E53238',
      etsy: '#F56400',
      amazon: '#FF9900',
    });
    expect(MARKETPLACE_SHORT).toEqual({
      olx: 'OL',
      allegro: 'AL',
      vinted: 'VI',
      facebook: 'FB',
      ebay: 'EB',
      etsy: 'ET',
      amazon: 'AM',
    });
  });

  it('renders the short code with the channel name as its accessible label', () => {
    for (const key of MARKETPLACE_KEY_LIST) {
      const html = renderToStaticMarkup(<MarketplaceBrandChip marketplaceKey={key} />);

      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${MARKETPLACE_NAMES[key]} logo"`);
      expect(html).toContain(`>${MARKETPLACE_SHORT[key]}</div>`);
    }
  });

  it('draws the code on a tint of the brand colour in light and dark mode', () => {
    for (const key of MARKETPLACE_KEY_LIST) {
      const brand = MARKETPLACE_BRAND_COLORS[key];
      const light = chipStyles({ marketplaceKey: key }, 'light');
      const dark = chipStyles({ marketplaceKey: key }, 'dark');

      expect(light.bgcolor).toBe(alpha(brand, 0.12));
      expect(light.color).toBe(darken(brand, 0.3));
      expect(dark.bgcolor).toBe(alpha(brand, 0.18));
      expect(dark.color).toBe(brand);
    }
  });

  it('renders a compact chip for the sm size', () => {
    const md = chipStyles({ marketplaceKey: 'olx' }, 'light');
    const sm = chipStyles({ marketplaceKey: 'olx', size: 'sm' }, 'light');

    expect(md).toMatchObject({ width: 40, height: 40 });
    expect(sm).toMatchObject({ width: 28, height: 28 });
  });
});
