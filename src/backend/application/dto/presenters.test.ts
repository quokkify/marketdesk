import { presentConversationThread, presentHermesEvent, presentListing, presentMarketplace } from './presenters';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import { unwrap, money } from '../../domain/testkit/support';
import type { MarketplaceKey } from '../../../shared/types';

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

describe('presentMarketplace', () => {
  function marketplace(key: MarketplaceKey) {
    return unwrap(
      Marketplace.create({
        id: `marketplace-${key}`,
        workspaceId: 'ws-1',
        key,
        name: key,
        connected: true,
      }),
    );
  }

  it('flags OLX as sandbox only while the OLX adapter is not real', () => {
    expect(presentMarketplace(marketplace('olx'), { olxSandbox: true }).sandbox).toBe(true);
    expect(presentMarketplace(marketplace('olx'), { olxSandbox: false }).sandbox).toBe(false);
  });

  it('never flags other marketplaces as sandbox', () => {
    expect(presentMarketplace(marketplace('allegro'), { olxSandbox: true }).sandbox).toBe(false);
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

describe('presentConversationThread', () => {
  const at = new Date('2026-11-21T10:00:00.000Z');
  const thread = {
    id: 't1', workspaceId: 'w1', listingId: 'l1', productId: 'p1', externalThreadId: 'ext-1',
    externalBuyerId: 'b1', status: 'open' as const, suspiciousReasons: [], lastExternalMessageId: 'm2',
    retentionStartsAt: null, textPurgedAt: null, createdAt: at, updatedAt: at,
  };
  const draft = {
    id: 'd1', threadId: 't1', answersMessageId: 'm1', intent: 'haggle' as const, proposedText: 'I can offer 90 zł.',
    sentText: null, filledPrice: 90, status: 'pending' as const, failureReason: null, source: 'offline' as const,
    attemptKey: null, attemptStartedAt: null, externalMessageId: null, createdAt: at, updatedAt: at,
  };

  it('maps messages and the draft, flagging an offline draft', () => {
    const view = presentConversationThread(thread, [
      { id: 'm1', threadId: 't1', externalMessageId: 'x1', direction: 'buyer', text: 'Hi', textHash: 'h', sentAt: at },
    ], draft);

    expect(view).toEqual({
      id: 't1', status: 'open', suspiciousReasons: [],
      messages: [{ id: 'm1', direction: 'buyer', text: 'Hi', sentAt: '2026-11-21T10:00:00.000Z' }],
      draft: {
        id: 'd1', status: 'pending', intent: 'haggle', text: 'I can offer 90 zł.', filledPrice: 90,
        failureReason: null, offline: true,
      },
    });
  });

  it('keeps purged text null, shows the sent text and reports no draft as null', () => {
    const purged = presentConversationThread(thread, [
      { id: 'm1', threadId: 't1', externalMessageId: 'x1', direction: 'buyer', text: null, textHash: null, sentAt: at },
    ], { ...draft, proposedText: null, sentText: null, source: 'hermes' });
    expect(purged.messages[0].text).toBeNull();
    expect(purged.draft).toMatchObject({ text: null, offline: false });

    const sent = presentConversationThread(thread, [], { ...draft, status: 'sent', sentText: 'edited' });
    expect(sent.draft?.text).toBe('edited');

    expect(presentConversationThread(thread, [], null).draft).toBeNull();
  });
});
