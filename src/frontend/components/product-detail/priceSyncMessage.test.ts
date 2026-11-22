import type { PriceSync } from '@shared/types';
import { priceSyncMessage } from './priceSyncMessage.js';

const PRICE = '318,00 zł';
const sync = (over: Partial<PriceSync>): PriceSync => ({
  unchanged: false,
  marketplaceUpdates: [],
  skippedLiveListings: [],
  ...over,
});
const update = { listingId: 'l1' } as PriceSync['marketplaceUpdates'][number];

describe('priceSyncMessage', () => {
  it('says the price was sent when an OLX update was queued', () => {
    expect(priceSyncMessage(sync({ marketplaceUpdates: [update] }), PRICE)).toBe(
      'Price 318,00 zł saved and sent to OLX.',
    );
  });

  it.each(['marketplace_not_connected', 'marketplace_account_not_connected'])(
    'explains a skipped listing (%s)',
    (reason) => {
      expect(
        priceSyncMessage(sync({ skippedLiveListings: [{ listingId: 'l1', reason }] }), PRICE),
      ).toBe('Price 318,00 zł saved. Not sent to OLX: OLX is not connected.');
    },
  );

  it('uses an unknown reason as is', () => {
    expect(
      priceSyncMessage(sync({ skippedLiveListings: [{ listingId: 'l1', reason: 'rate limited' }] }), PRICE),
    ).toBe('Price 318,00 zł saved. Not sent to OLX: rate limited.');
  });

  it('prefers sent over skipped', () => {
    expect(
      priceSyncMessage(
        sync({
          marketplaceUpdates: [update],
          skippedLiveListings: [{ listingId: 'l2', reason: 'marketplace_not_connected' }],
        }),
        PRICE,
      ),
    ).toBe('Price 318,00 zł saved and sent to OLX.');
  });

  it.each([
    ['no live listing', sync({})],
    ['unchanged', sync({ unchanged: true })],
    ['undefined', undefined],
  ])('only says saved for %s', (_name, value) => {
    expect(priceSyncMessage(value, PRICE)).toBe('Price 318,00 zł saved.');
  });
});
