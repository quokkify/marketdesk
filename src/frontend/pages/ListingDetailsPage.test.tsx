import type { HermesEvent, Listing, Marketplace, ProductRecheckResult } from '@shared/types';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildPublishListingInput,
  categoryConflictEvidenceLines,
  categoryLookupUnavailable,
  CategoryLookupUnavailableNotice,
  delistSuccessMessage,
  editRequestedByNavigation,
  mainPreviewImageSx,
  isProductRecheckStale,
  PUBLICATION_READINESS_CHECKING_LABEL,
  PUBLICATION_READINESS_RECHECK_LABEL,
  PublicationReadinessAction,
  productAnalysisProvider,
  productHermesAnalyzingNote,
  productHermesDisabledReason,
  productHermesSuccessMessage,
  productPrimaryAction,
  ProductRecheckReview,
  PublishPreviewReview,
  productScopedHermesRunInput,
  publicationReviewSubtitle,
  remoteMarketplaceChipColor,
  remoteMarketplacePresentation,
  selectPrimaryListing,
  selectProductRecommendations,
} from './ListingDetailsPage';
import { hermesEventDismissOnly } from '../components/hermes/HermesEventCard';
import type { PublishListingPreview } from '../state/api/dto';
import { formatDateTime } from '../utils/formatters';

const listing: Listing = {
  id: 'listing-1',
  productId: 'product-1',
  marketplaceId: 'marketplace-1',
  marketplaceListingId: 'olx-123',
  externalUrl: 'https://www.olx.pl/d/oferta/olx-123',
  price: 399,
  status: 'live',
  remoteStatus: 'active',
  remoteStatusLabel: 'Active',
  isRemotePending: false,
  views: 3,
  watchers: 0,
  messages: 0,
  publishedAt: '2026-07-15T17:00:00.000Z',
  lastSyncAt: '2026-07-15T19:04:00.000Z',
  createdAt: '2026-07-15T16:00:00.000Z',
  updatedAt: '2026-07-15T19:04:00.000Z',
};

function event(
  id: string,
  productId: string | undefined,
  status: HermesEvent['status']
): HermesEvent {
  return {
    id,
    workspaceId: 'workspace-1',
    productId,
    type: 'suggested_better_title',
    severity: 'info',
    status,
    title: `Suggestion ${id}`,
    proposedChange: { kind: 'title', field: 'title', from: 'Old', to: 'New' },
    createdAt: '2026-07-15T18:00:00.000Z',
  };
}

describe('ListingDetailsPage presentation', () => {
  it('builds a product-scoped Hermes run input for the selected product only', () => {
    expect(productScopedHermesRunInput('product-1')).toEqual({
      trigger: 'manual',
      productId: 'product-1',
    });
  });

  it('keeps the product Hermes action disabled until settings allow listing SEO', () => {
    expect(
      productHermesDisabledReason({
        productId: 'product-1',
        settingsLoaded: false,
        listingSeoEnabled: false,
      })
    ).toBe('Hermes settings are still loading.');
    expect(
      productHermesDisabledReason({
        productId: 'product-1',
        settingsLoaded: true,
        listingSeoEnabled: false,
      })
    ).toBe('Enable the listing SEO agent in Hermes settings first.');
    expect(
      productHermesDisabledReason({
        productId: 'product-1',
        settingsLoaded: true,
        listingSeoEnabled: true,
      })
    ).toBeNull();
  });

  it('names the provider that is analyzing the product and stays neutral while it is unknown', () => {
    expect(productHermesAnalyzingNote('hermes')).toBe(
      'Hermes is analyzing this product only. Any recommendation will remain review-only.'
    );
    expect(productHermesAnalyzingNote('offline')).toBe(
      'Offline heuristics are analyzing this product only. Any recommendation will remain review-only.'
    );
    expect(productHermesAnalyzingNote(undefined)).toBe(
      'Analyzing this product only. Any recommendation will remain review-only.'
    );
  });

  it('credits the provider that answered the analysis and stays neutral when it is unknown', () => {
    expect(productHermesSuccessMessage(1, 'hermes')).toBe(
      'Hermes suggested an SEO change for human review.'
    );
    expect(productHermesSuccessMessage(2, 'offline')).toBe(
      'Offline heuristics suggested 2 SEO changes for human review.'
    );
    expect(productHermesSuccessMessage(1, undefined)).toBe(
      'An SEO suggestion is ready for human review.'
    );
    expect(productHermesSuccessMessage(3, undefined)).toBe(
      '3 SEO suggestions are ready for human review.'
    );
    expect(productHermesSuccessMessage(0, 'hermes')).toBe(
      'Hermes found no new SEO suggestion for this product.'
    );
    expect(productHermesSuccessMessage(0, 'offline')).toBe(
      'Offline heuristics found no new SEO suggestion for this product.'
    );
    expect(productHermesSuccessMessage(0, undefined)).toBe(
      'No new SEO suggestion was found for this product.'
    );
  });

  it('never credits Hermes when the offline heuristics answered or the provider is unknown', () => {
    for (const count of [0, 1, 2]) {
      expect(productHermesSuccessMessage(count, 'offline')).not.toContain('Hermes');
      expect(productHermesSuccessMessage(count, undefined)).not.toContain('Hermes');
    }
  });

  it('takes the provider from the returned suggestions before the provider status', () => {
    const offline = { source: 'offline' as const };
    const hermes = { source: 'hermes' as const };

    expect(productAnalysisProvider([offline], 'hermes')).toBe('offline');
    expect(productAnalysisProvider([hermes, hermes], 'offline')).toBe('hermes');
    expect(productAnalysisProvider([], 'offline')).toBe('offline');
    expect(productAnalysisProvider([], 'hermes')).toBe('hermes');
    expect(productAnalysisProvider([], undefined)).toBeUndefined();
    expect(productAnalysisProvider([{}], 'hermes')).toBeUndefined();
    expect(productAnalysisProvider([offline, hermes], 'hermes')).toBeUndefined();
  });

  it('marks a recheck stale immediately when the saved product version changes', () => {
    const result = {
      productId: 'product-1', listingId: 'listing-1',
      productUpdatedAt: '2026-07-22T06:00:00.000Z', listingUpdatedAt: '2026-07-22T06:01:00.000Z',
    } as ProductRecheckResult;
    expect(isProductRecheckStale(
      result, 'product-1', result.productUpdatedAt, 'listing-1', result.listingUpdatedAt,
    )).toBe(false);
    expect(isProductRecheckStale(
      result, 'product-1', '2026-07-22T07:00:00.000Z', 'listing-1', result.listingUpdatedAt,
    )).toBe(true);
    expect(isProductRecheckStale(
      result, 'product-1', result.productUpdatedAt, 'listing-2', result.listingUpdatedAt,
    )).toBe(true);
    expect(isProductRecheckStale(
      result, 'product-2', result.productUpdatedAt, 'listing-1', result.listingUpdatedAt,
    )).toBe(true);
    expect(isProductRecheckStale(
      result, 'product-1', result.productUpdatedAt, 'listing-1', '2026-07-22T07:00:00.000Z',
    )).toBe(true);
  });

  it('renders the typed mismatch, exact provider id/path and stale replacement state', () => {
    const result: ProductRecheckResult = {
      productId: 'product-1', listingId: 'listing-1', marketplaceId: 'marketplace-1', workspaceId: 'workspace-1',
      productUpdatedAt: '2026-07-22T06:00:00.000Z', listingUpdatedAt: '2026-07-22T06:01:00.000Z',
      accountRevision: 7, checkedAt: '2026-07-22T06:05:00.000Z',
      status: 'review', canPublish: false, autoApplied: false,
      items: [{
        key: 'category', status: 'review', editField: 'category',
        message: 'Product identity contradicts OLX category Electronics → Audio → Wireless headphones',
      }],
      category: {
        providerCategoryId: 'headphones-wireless',
        path: ['Electronics', 'Audio', 'Wireless headphones'],
        confidence: 0.96, isLeaf: true,
        taxonomyVerifiedAt: '2026-07-22T05:00:00.000Z',
        taxonomyStaleAt: '2026-07-23T05:00:00.000Z',
        reason: 'semantic_mismatch', suggestion: null, confirmationRequired: false,
      },
    };
    const currentHtml = renderToStaticMarkup(
      <ProductRecheckReview result={result} currentProductId={result.productId}
        currentProductUpdatedAt={result.productUpdatedAt} currentListingId={result.listingId}
        currentListingUpdatedAt={result.listingUpdatedAt} />,
    );
    expect(currentHtml).toContain('User review is required');
    expect(currentHtml).toContain('headphones-wireless');
    expect(currentHtml).toContain('Electronics → Audio → Wireless headphones');
    expect(currentHtml).not.toContain('Ready to publish');

    const staleHtml = renderToStaticMarkup(
      <ProductRecheckReview
        result={result}
        currentProductId={result.productId}
        currentProductUpdatedAt={result.productUpdatedAt}
        currentListingId={result.listingId}
        currentListingUpdatedAt="2026-07-22T07:00:00.000Z"
      />,
    );
    expect(staleHtml).toContain('result is stale');
    expect(staleHtml).not.toContain('headphones-wireless');

    const suggestedHtml = renderToStaticMarkup(
      <ProductRecheckReview
        result={{
          ...result,
          category: {
            ...result.category,
            suggestion: {
              providerCategoryId: 'projectors-91', name: 'Projectors',
              path: ['Electronics', 'TV and video', 'Projectors'], source: 'provider_taxonomy',
              confidence: 1, isLeaf: true,
              taxonomyVerifiedAt: '2026-07-22T05:00:00.000Z',
              taxonomyStaleAt: '2026-07-23T05:00:00.000Z',
            },
            confirmationRequired: true,
          },
        }}
        currentProductId={result.productId}
        currentProductUpdatedAt={result.productUpdatedAt}
        currentListingId={result.listingId}
        currentListingUpdatedAt={result.listingUpdatedAt}
      />,
    );
    expect(suggestedHtml).toContain('projectors-91');
    expect(suggestedHtml).toContain('requires explicit confirmation');
  });

  it('exposes current and candidate listing evidence for a category conflict', () => {
    const source = {
      marketplaceKey: 'olx' as const, marketplaceId: 'marketplace-1',
      providerCategoryId: '100', name: 'Projectors', path: ['Electronics', 'Projectors'],
      taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z', syncedAt: '2026-07-15T01:00:00.000Z',
    };
    expect(categoryConflictEvidenceLines({
      status: 'conflict', detectedAt: '2026-07-15T02:00:00.000Z',
      currentSources: [{ ...source, listingId: 'listing-current' }],
      candidates: [{ ...source, listingId: 'listing-candidate', providerCategoryId: '200', path: ['Electronics', 'Audio'] }],
    })).toEqual([
      `Current · listing listing-current · Electronics › Projectors · ID 100 · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
      `Candidate · listing listing-candidate · Electronics › Audio · ID 200 · Taxonomy verified ${formatDateTime(source.taxonomyVerifiedAt)} · Synced ${formatDateTime(source.syncedAt)}`,
    ]);
  });

  it.each([
    ['low-confidence', 'Category confidence 0.42 is below the required threshold'],
    ['stale', 'OLX taxonomy verification is stale'],
  ])('keeps exact category identity and the %s blocker visible in publish review', (_case, reason) => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: false, reason: null },
      listingId: 'listing-projector',
      status: 'draft',
      marketplaceKey: 'olx',
      sandbox: false,
      payload: {
        productName: 'AOPEN QH11 projector',
        description: 'HD projector',
        price: 299,
        currency: 'PLN',
        category: 'electronics',
        marketplaceCategory: null,
        condition: 'used',
        imageCount: 2,
      },
      marketplaceCategory: {
        providerCategoryId: 'projectors-91',
        name: 'Projectors',
        path: ['Electronics', 'TV and video', 'Projectors'],
        source: 'provider_taxonomy',
        confidence: 0.42,
        isLeaf: true,
        taxonomyVerifiedAt: '2026-06-01T00:00:00.000Z',
        taxonomyStaleAt: '2026-06-02T00:00:00.000Z',
      },
      warnings: [reason],
    };

    const html = renderToStaticMarkup(<PublishPreviewReview preview={preview} />);

    expect(html).toContain('projectors-91');
    expect(html).toContain('Electronics → TV and video → Projectors');
    expect(html).toContain(reason);
    expect(html).toContain('Publication is blocked');
  });

  it('builds a single-operation quota override only after explicit valid confirmation', () => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: true, reason: 'quota_unknown' },
      listingId: 'listing-frezarka',
      status: 'expired',
      marketplaceKey: 'olx',
      sandbox: false,
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX quota blocks publication: quota_unknown'],
    };

    expect(buildPublishListingInput('listing-frezarka', preview, false, 'Possible fee accepted')).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, 'short')).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, 'x'.repeat(501))).toBeNull();
    expect(buildPublishListingInput('listing-frezarka', preview, true, '  Possible fee accepted  ')).toEqual({
      id: 'listing-frezarka',
      quotaOverride: { confirmed: true, reason: 'Possible fee accepted' },
    });
  });

  it('never builds an override for non-quota blockers and leaves normal publish unchanged', () => {
    const blocked: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: false, reason: 'quota_unknown' },
      listingId: 'listing-projector',
      status: 'draft',
      marketplaceKey: 'olx',
      sandbox: false,
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX taxonomy verification is stale', 'OLX quota blocks publication: quota_unknown'],
    };

    expect(buildPublishListingInput('listing-projector', blocked, true, 'Accept possible provider fee')).toBeNull();
    expect(buildPublishListingInput(
      'listing-projector',
      { ...blocked, canPublish: true, quotaOverrideEligibility: { eligible: false, reason: null }, warnings: [] },
      true,
      'This must not be sent',
    )).toEqual({ id: 'listing-projector' });
  });

  it('presents eligible quota blocks as explicit fee-risk confirmation rather than a bypass', () => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: false,
      quotaOverrideEligibility: { eligible: true, reason: 'quota_unknown' },
      listingId: 'listing-frezarka',
      status: 'expired',
      marketplaceKey: 'olx',
      sandbox: false,
      payload: null,
      marketplaceCategory: null,
      warnings: ['OLX quota blocks publication: quota_unknown'],
    };

    const html = renderToStaticMarkup(<PublishPreviewReview preview={preview} />);
    expect(html).toContain('operation-scoped fee-risk confirmation');
    expect(html).toContain('Quota confirmation required');
  });

  it('labels a publication that would go to the OLX sandbox with a Sandbox chip', () => {
    const preview: PublishListingPreview = {
      dryRun: true,
      canPublish: true,
      quotaOverrideEligibility: { eligible: false, reason: null },
      listingId: 'listing-1',
      status: 'draft',
      marketplaceKey: 'olx',
      sandbox: true,
      payload: null,
      marketplaceCategory: null,
      warnings: [],
      categoryDecision: { allowed: true, requiresReview: false },
    };

    const sandbox = renderToStaticMarkup(<PublishPreviewReview preview={preview} />);
    const real = renderToStaticMarkup(<PublishPreviewReview preview={{ ...preview, sandbox: false }} />);

    expect(sandbox).toContain('>Sandbox<');
    expect(real).not.toContain('Sandbox');
  });

  it('centers the full-size preview without stretching it across both axes', () => {
    expect(mainPreviewImageSx).toMatchObject({
      display: 'block',
      width: 'auto',
      height: 'auto',
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      margin: 'auto',
    });
  });

  it('uses non-success colors for failed and ended remote states', () => {
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'active' })).toBe('success');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'rejected' })).toBe('error');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'expired' })).toBe('default');
    expect(remoteMarketplaceChipColor({ ...listing, remoteStatus: 'moderation' })).toBe('warning');
  });

  it('prefers the OLX listing when a product is listed on several marketplaces', () => {
    const otherListing = { ...listing, id: 'listing-other', marketplaceId: 'marketplace-other' };
    const marketplaces = [
      { id: 'marketplace-other', key: 'ebay' },
      { id: 'marketplace-1', key: 'olx' },
    ] as Marketplace[];

    expect(selectPrimaryListing([otherListing, listing], marketplaces)?.id).toBe('listing-1');
  });

  it('explains the provider status without repeating an unlabeled Active value', () => {
    expect(remoteMarketplacePresentation(listing, 'OLX')).toEqual(
      expect.objectContaining({
        title: 'OLX listing',
        status: 'Active on OLX',
        explanation:
          'Current listing status reported by OLX. This is separate from the product status in MarketDesk.',
        externalUrl: listing.externalUrl,
      })
    );
  });

  it('attributes the provider status of a sandbox listing to the OLX sandbox', () => {
    expect(remoteMarketplacePresentation(listing, 'OLX', true).explanation).toBe(
      'Current listing status reported by the OLX sandbox. This is separate from the product status in MarketDesk.'
    );
    expect(remoteMarketplacePresentation(listing, 'OLX', false).explanation).toBe(
      'Current listing status reported by OLX. This is separate from the product status in MarketDesk.'
    );
  });

  it('confirms a sandbox delist as a return to draft without claiming a remote advert', () => {
    expect(delistSuccessMessage(true)).toBe('Listing returned to draft (sandbox).');
    expect(delistSuccessMessage(false)).toBe(
      'Remote advert removed; listing returned to draft. Nothing was republished.'
    );
  });

  it('keeps pending and not-yet-synced provider states internally consistent', () => {
    expect(
      remoteMarketplacePresentation(
        { ...listing, remoteStatusLabel: undefined, isRemotePending: true },
        'OLX',
      ),
    ).toMatchObject({
      status: 'Pending on OLX',
      explanation:
        'OLX is still moderating or activating this listing. Metrics may be unavailable until it becomes active.',
    });

    expect(
      remoteMarketplacePresentation(
        { ...listing, remoteStatusLabel: undefined, isRemotePending: false },
        'OLX',
      ),
    ).toMatchObject({
      status: 'Not synced with OLX',
      explanation: 'OLX has not reported a listing status yet.',
    });
  });

  it('shows only pending Hermes recommendations for the current product', () => {
    const events = [
      event('current', 'product-1', 'pending_review'),
      event('other', 'product-2', 'pending_review'),
      event('resolved', 'product-1', 'applied'),
      event('workspace-only', undefined, 'pending_review'),
    ];

    expect(selectProductRecommendations(events, 'product-1').map(({ id }) => id)).toEqual([
      'current',
    ]);
  });

  it('treats recommendations without proposed changes as dismiss-only, not Apply/applied', () => {
    expect(hermesEventDismissOnly({
      ...event('photos', 'product-1', 'pending_review'),
      type: 'suggested_more_photos',
      proposedChange: null,
    })).toBe(true);
    expect(hermesEventDismissOnly(event('title', 'product-1', 'pending_review'))).toBe(false);
  });

  it('uses English labels for the publication readiness recheck action', () => {
    expect(PUBLICATION_READINESS_RECHECK_LABEL).toBe('Check again');
    expect(PUBLICATION_READINESS_CHECKING_LABEL).toBe('Checking…');
    expect(PUBLICATION_READINESS_RECHECK_LABEL).not.toMatch(/[А-Яа-я]/);
    expect(PUBLICATION_READINESS_CHECKING_LABEL).not.toMatch(/[А-Яа-я]/);

    const idle = renderToStaticMarkup(
      <PublicationReadinessAction rechecking={false} disabled={false} onClick={() => undefined} />,
    );
    const checking = renderToStaticMarkup(
      <PublicationReadinessAction rechecking disabled={false} onClick={() => undefined} />,
    );
    expect(idle).toContain('>Check again<');
    expect(idle).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
    expect(checking).toContain('>Checking…<');
    expect(checking).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
  });

  it('opens the edit form only for an explicit catalogue Edit navigation', () => {
    expect(editRequestedByNavigation({ editProduct: true })).toBe(true);
    expect(editRequestedByNavigation({ editProduct: 'yes' })).toBe(false);
    expect(editRequestedByNavigation({ publicationReview: { listingId: 'l-1', mode: 'relist' } })).toBe(false);
    expect(editRequestedByNavigation(null)).toBe(false);
    expect(editRequestedByNavigation(undefined)).toBe(false);
  });
});

describe('product detail primary action', () => {
  const draftListing: Listing = { ...listing, status: 'draft' };

  it('publishes a draft to a connected OLX account', () => {
    expect(
      productPrimaryAction({ productStatus: 'draft', olxListing: undefined, olxConnected: true })
    ).toBe('publish');
    expect(
      productPrimaryAction({ productStatus: 'draft', olxListing: draftListing, olxConnected: true })
    ).toBe('publish');
  });

  it('asks to connect OLX before a product can be published', () => {
    expect(
      productPrimaryAction({ productStatus: 'draft', olxListing: undefined, olxConnected: false })
    ).toBe('connect');
    expect(
      productPrimaryAction({
        productStatus: 'active',
        olxListing: { ...listing, status: 'expired' },
        olxConnected: false,
      })
    ).toBe('connect');
  });

  it('edits live and sold products and relists expired or failed listings', () => {
    expect(
      productPrimaryAction({ productStatus: 'active', olxListing: listing, olxConnected: true })
    ).toBe('edit');
    expect(
      productPrimaryAction({ productStatus: 'active', olxListing: listing, olxConnected: false })
    ).toBe('edit');
    expect(
      productPrimaryAction({ productStatus: 'sold', olxListing: draftListing, olxConnected: true })
    ).toBe('edit');
    expect(
      productPrimaryAction({
        productStatus: 'active',
        olxListing: { ...listing, status: 'expired' },
        olxConnected: true,
      })
    ).toBe('relist');
    expect(
      productPrimaryAction({
        productStatus: 'attention',
        olxListing: { ...listing, status: 'error', marketplaceListingId: undefined },
        olxConnected: true,
      })
    ).toBe('relist');
  });

  it('does not offer a relist the server refuses for a failed listing that still references an OLX advert', () => {
    expect(
      productPrimaryAction({
        productStatus: 'attention',
        olxListing: { ...listing, status: 'error', marketplaceListingId: 'olx-123' },
        olxConnected: true,
      })
    ).toBe('edit');
  });
});

describe('OLX category lookup availability', () => {
  it('treats a missing or unavailable taxonomy endpoint as unavailable', () => {
    expect(categoryLookupUnavailable({ status: 404, data: {} })).toBe(true);
    expect(categoryLookupUnavailable({ status: 503, data: {} })).toBe(true);
    expect(categoryLookupUnavailable({ status: 400, data: {} })).toBe(false);
    expect(categoryLookupUnavailable(new Error('Network down'))).toBe(false);
    expect(categoryLookupUnavailable(undefined)).toBe(false);
  });

  it('explains an unavailable OLX category lookup in one alert with the server message', () => {
    const html = renderToStaticMarkup(
      <CategoryLookupUnavailableNotice message="OLX category search is temporarily unavailable" />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('OLX category lookup is unavailable');
    expect(html).toContain('OLX category search is temporarily unavailable');
    expect(html).toContain('Categories cannot be searched or verified here right now.');
  });
});

describe('publication review subtitle', () => {
  it('labels a sandbox OLX publication review', () => {
    expect(publicationReviewSubtitle('olx', true)).toBe('OLX · Sandbox');
    expect(publicationReviewSubtitle('olx', false)).toBe('OLX');
    expect(publicationReviewSubtitle(undefined, false)).toBe('Marketplace');
  });
});
