import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SaleVerdict, VerdictCheck } from '@shared/types';
import { lightTheme } from '../../../theme/lightTheme';
import { ChecksTab } from './ChecksTab';

const NOW = new Date('2026-11-22T12:00:00.000Z');

function check(name: VerdictCheck['check'], status: VerdictCheck['status'], reasons: VerdictCheck['reasons'] = [], refs: Partial<VerdictCheck['refs']> = {}): VerdictCheck {
  return { check: name, status, reasons, checkedAt: '2026-11-22T11:00:00.000Z', refs: { eventIds: [], ...refs } };
}

const verdict: SaleVerdict = {
  id: 'v-1',
  productId: 'p-1',
  listingId: null,
  graphVersion: '1',
  scope: ['info', 'price', 'photos'],
  status: 'completed',
  overall: 'fix',
  checks: {
    price: check('price', 'fix', [{ code: 'above_ceiling', message: 'The price is above the fair ceiling.' }], {
      currentPrice: 280,
      proposedPrice: 169,
      currency: 'PLN',
    }),
    info: check('info', 'ready'),
    photos: check('photos', 'needs_human', [
      { code: 'few_photos', message: 'Only one photo.', field: 'images' },
      { code: 'no_cover', message: 'No cover photo is set.' },
    ]),
  },
  researchRunId: null,
  errorCode: null,
  createdAt: '2026-11-22T11:00:00.000Z',
  completedAt: '2026-11-22T11:01:00.000Z',
};

function render(props: Partial<React.ComponentProps<typeof ChecksTab>> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <ChecksTab
        verdict={verdict}
        setPrice={null}
        busy={false}
        now={NOW}
        onSetPrice={() => undefined}
        onOpenPrices={() => undefined}
        onEdit={() => undefined}
        {...props}
      />
    </ThemeProvider>
  );
}

describe('ChecksTab', () => {
  it('lists every check with its mark, figures, every reason and its age', () => {
    const html = render();

    expect(html).toContain('Price ✗ 280 → 169 zł');
    expect(html).toContain('Info ✓');
    expect(html).toContain('Photos ?');
    expect(html).toContain('The price is above the fair ceiling.');
    expect(html).toContain('Only one photo.');
    expect(html).toContain('No cover photo is set.');
    expect(html).toContain('Checked 1h ago');
    expect(html).toContain('See the prices');
  });

  it('offers the price fix and the product editor where a reason names a field', () => {
    const html = render({ setPrice: { label: 'Set price to 169 zł', eventId: 'event-1' } });

    expect(html).toMatch(/<button[^>]*>Set price to 169 zł<\/button>/);
    const photos = html.slice(html.indexOf('data-testid="hermes-check-photos"'));
    expect(photos).toContain('Edit product');
    const info = html.slice(html.indexOf('data-testid="hermes-check-info"'), html.indexOf('data-testid="hermes-check-photos"'));
    expect(info).not.toContain('Edit product');
  });

  it('says nothing was checked before the first verdict and keeps the readiness check below', () => {
    const html = render({ verdict: null, children: <p>Readiness</p> });

    expect(html).toContain('Not checked yet. Run Analyze to get a verdict.');
    expect(html).toContain('Readiness');
  });
});
