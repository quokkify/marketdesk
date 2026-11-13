import { MarketplaceAdapterFactory } from '../MarketplaceAdapterFactory';
import { OLXAdapter } from '../OLXAdapter';
import { MarketplaceNotImplementedError } from '../MarketplaceError';

describe('MarketplaceAdapterFactory', () => {
  const factory = new MarketplaceAdapterFactory();

  it('creates the OLX adapter', () => {
    const adapter = factory.create('olx');
    expect(adapter).toBeInstanceOf(OLXAdapter);
    expect(adapter.getKey()).toBe('olx');
  });

  it.each(['allegro', 'vinted', 'facebook', 'ebay', 'etsy', 'amazon'] as const)(
    'fails closed for %s',
    (key) => {
      expect(factory.isSupported(key)).toBe(false);
      expect(() => factory.create(key)).toThrow(MarketplaceNotImplementedError);
    },
  );
});
