import { presentHermesEvent, presentListing } from './presenters';
import { Listing } from '../../domain/entities/Listing';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import { unwrap, money } from '../../domain/testkit/support';

function listingWithExternalUrl(url: string | null, status: 'live' | 'draft' = 'live') {
  return unwrap(
    Listing.create({
      id: 'listing-1',
      productId: 'product-1',
      marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1',
      externalUrl: url,
      price: money(50),
      status,
      publishedAt: new Date('2026-07-15T00:00:00.000Z'),
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    }),
  );
}

describe('presentListing', () => {
  it('returns canonical HTTPS OLX external URLs', () => {
    const view = presentListing(listingWithExternalUrl('https://www.olx.pl/d/oferta/camera-123'));

    expect(view.externalUrl).toBe('https://www.olx.pl/d/oferta/camera-123');
  });

  it.each([
    'http://www.olx.pl/d/oferta/camera-123',
    'https://evil.example/phishing',
    'not-a-url',
  ])('omits unsafe external URL %s', (url: string) => {
    const view = presentListing(listingWithExternalUrl(url));

    expect(view.externalUrl).toBeUndefined();
  });

  it('omits canonical external URLs for draft listings', () => {
    const view = presentListing(
      listingWithExternalUrl('https://www.olx.pl/d/oferta/draft-123', 'draft'),
    );

    expect(view.externalUrl).toBeUndefined();
  });

  it('distinguishes unavailable conversation/message metrics from real zeroes', () => {
    const listing = listingWithExternalUrl('https://www.olx.pl/d/oferta/camera-123');
    listing.recordSyncStats({ conversations: 0, messages: 0 });
    const zero = presentListing(listing);
    listing.recordMessagesUnavailable();
    const unavailable = presentListing(listing);

    expect(zero.conversations).toBe(0);
    expect(zero.metricsAvailability?.conversations).toBe(true);
    expect(zero.messages).toBe(0);
    expect(zero.metricsAvailability?.messages).toBe(true);
    expect(unavailable.conversations).toBeNull();
    expect(unavailable.metricsAvailability?.conversations).toBe(false);
    expect(unavailable.messages).toBeNull();
    expect(unavailable.metricsAvailability?.messages).toBe(false);
  });
});

describe('presentHermesEvent', () => {
  function titleEvent(source?: 'hermes' | 'offline') {
    return unwrap(
      HermesEvent.create({
        id: 'event-1',
        workspaceId: 'workspace-1',
        productId: 'product-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Improve product title for search',
        detail: 'Camera - Good condition. Heuristic offline suggestion; Hermes was not consulted.',
        proposedChange: { kind: 'title', field: 'title', from: 'Camera', to: 'Camera - Good condition' },
        source,
      }),
    );
  }

  it('shows which provider produced an AI-made event', () => {
    expect(presentHermesEvent(titleEvent('offline')).source).toBe('offline');
    expect(presentHermesEvent(titleEvent('hermes')).source).toBe('hermes');
  });

  it('leaves the source out when no provider is recorded', () => {
    expect(presentHermesEvent(titleEvent()).source).toBeUndefined();
  });
});
