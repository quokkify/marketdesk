import type { Listing, MarketplaceCategoryMetadata } from '@shared/types';
import type { PublishListingPreview } from '../state/api/dto';
import type { WizardSubmission } from '../components/forms/ProductWizardForm';
import type { PublicationJourneyState } from './publicationJourneyContract';
import { advancePublicationJourney } from './publicationJourneyGraph';
import { runCreationJourney, submitWizardProduct } from './creationJourney';
import type { CreationJourneyDeps, TargetConnection, WizardProductDeps } from './creationJourney';

const marketplace = { id: 'marketplace-1', key: 'olx' as const };

function category(providerCategoryId: string): MarketplaceCategoryMetadata {
  return {
    providerCategoryId,
    name: `Category ${providerCategoryId}`,
    path: ['Electronics', `Category ${providerCategoryId}`],
    source: 'user_confirmed',
    confidence: 1,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-11-13T10:00:00.000Z',
    taxonomyStaleAt: '2026-11-20T10:00:00.000Z',
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    productId: 'p1',
    marketplaceId: marketplace.id,
    price: 100,
    status: 'draft',
    views: null,
    watchers: null,
    conversations: null,
    messages: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
    ...overrides,
  };
}

function preview(overrides: Partial<PublishListingPreview> = {}): PublishListingPreview {
  return {
    dryRun: true,
    canPublish: true,
    quotaOverrideEligibility: { eligible: false, reason: null },
    listingId: 'listing-1',
    status: 'draft',
    marketplaceKey: 'olx',
    sandbox: false,
    payload: null,
    warnings: [],
    marketplaceCategory: category('101'),
    ...overrides,
  };
}

const pending: PublicationJourneyState = {
  phase: 'product_saved',
  productId: 'p1',
  marketplaceKey: 'olx',
  providerCategoryId: '101',
  approvedInWizard: true,
};

function journeyDeps(overrides: Partial<CreationJourneyDeps> = {}) {
  const deps = {
    findListing: jest.fn<Listing | undefined, [string]>(() => undefined),
    createListing: jest.fn(async () => listing()),
    setCategory: jest.fn(async () => listing({ marketplaceCategory: category('101') })),
    preview: jest.fn(async () => preview()),
    publish: jest.fn(async () => listing({ status: 'live' })),
    ...overrides,
  };
  return deps;
}

describe('runCreationJourney', () => {
  it('queues the advert when the wizard approved it and the preview matches', async () => {
    const deps = journeyDeps();

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.createListing).toHaveBeenCalledTimes(1);
    expect(deps.createListing).toHaveBeenCalledWith({ productId: 'p1', marketplaceKey: 'olx' });
    expect(deps.setCategory).toHaveBeenCalledTimes(1);
    expect(deps.setCategory).toHaveBeenCalledWith({ id: 'listing-1', providerCategoryId: '101' });
    expect(deps.preview).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledWith({ id: 'listing-1' });
    expect(outcome.kind).toBe('queued');
    if (outcome.kind !== 'queued') return;
    expect(outcome.journey.phase).toBe('queued');
    expect(outcome.journey.listingId).toBe('listing-1');
  });

  it('reuses an existing draft listing for the marketplace', async () => {
    const deps = journeyDeps({ findListing: jest.fn(() => listing()) });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.findListing).toHaveBeenCalledWith('marketplace-1');
    expect(deps.createListing).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('queued');
  });

  it('does not save a category the listing already has', async () => {
    const deps = journeyDeps({
      findListing: jest.fn(() => listing({ marketplaceCategory: category('101') })),
    });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.setCategory).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('queued');
  });

  it('opens the review when only a quota override would allow publishing', async () => {
    const reviewPreview = preview({
      canPublish: false,
      quotaOverrideEligibility: { eligible: true, reason: 'quota_unknown' },
    });
    const deps = journeyDeps({ preview: jest.fn(async () => reviewPreview) });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.publish).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('review');
    if (outcome.kind !== 'review') return;
    expect(outcome.preview).toBe(reviewPreview);
    expect(outcome.journey.phase).toBe('publication_review');
  });

  it('opens the review when the server category differs from the wizard choice', async () => {
    const deps = journeyDeps({
      preview: jest.fn(async () => preview({ marketplaceCategory: category('202') })),
    });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.publish).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('review');
  });

  it('opens the review when the wizard did not approve the publication', async () => {
    const deps = journeyDeps();
    const { approvedInWizard: _approved, ...unapproved } = pending;

    const outcome = await runCreationJourney(unapproved, marketplace, deps);

    expect(deps.publish).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('review');
  });

  it('stops at the category step when saving the category fails', async () => {
    const created = listing();
    const failure = new Error('Category rejected');
    const deps = journeyDeps({
      createListing: jest.fn(async () => created),
      setCategory: jest.fn(async () => {
        throw failure;
      }),
    });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(outcome).toEqual({ kind: 'failed', step: 'category', error: failure, listing: created });
    expect(deps.preview).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('names the listing, preview and publish steps when they fail', async () => {
    const failure = new Error('boom');
    const reject = async () => {
      throw failure;
    };

    await expect(
      runCreationJourney(pending, marketplace, journeyDeps({ createListing: jest.fn(reject) })),
    ).resolves.toEqual({ kind: 'failed', step: 'listing', error: failure });
    await expect(
      runCreationJourney(pending, marketplace, journeyDeps({ preview: jest.fn(reject) })),
    ).resolves.toMatchObject({ kind: 'failed', step: 'preview', error: failure });
    await expect(
      runCreationJourney(pending, marketplace, journeyDeps({ publish: jest.fn(reject) })),
    ).resolves.toMatchObject({ kind: 'failed', step: 'publish', error: failure });
  });

  it('opens the review when neither the wizard nor the preview names a category', async () => {
    const deps = journeyDeps({
      preview: jest.fn(async () => preview({ marketplaceCategory: null })),
    });
    const { providerCategoryId: _category, ...uncategorised } = pending;

    const outcome = await runCreationJourney(uncategorised, marketplace, deps);

    expect(deps.setCategory).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('review');
  });

  it('reports a published advert as queued even when the last journey step fails', async () => {
    const published = listing({ status: 'live' });
    const deps = journeyDeps({
      publish: jest.fn(async () => published),
      advance: jest.fn(async (...args: Parameters<typeof advancePublicationJourney>) => {
        if (args[1].type === 'publication_queued') throw new Error('graph broke');
        return advancePublicationJourney(...args);
      }),
    });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('queued');
    if (outcome.kind !== 'queued') return;
    expect(outcome.listing).toBe(published);
    expect(outcome.journey.phase).toBe('queued');
  });

  it('skips a listing that is no longer a draft', async () => {
    const deps = journeyDeps({ findListing: jest.fn(() => listing({ status: 'live' })) });

    const outcome = await runCreationJourney(pending, marketplace, deps);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'listing_not_draft' });
    expect(deps.setCategory).not.toHaveBeenCalled();
    expect(deps.preview).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

const olxCategory = { providerCategoryId: '101', name: 'Phones', path: ['Electronics', 'Phones'] };

function submission(overrides: Partial<WizardSubmission> = {}): WizardSubmission {
  return {
    intent: 'publish',
    values: {
      name: 'Phone',
      sku: '',
      description: 'A phone in good condition with a charger and a box.',
      costPrice: null,
      sellingPrice: 100,
      condition: 'good',
      category: 'Phones',
      status: 'draft',
      tags: [],
      images: ['image-1'],
    },
    targetMarketplace: 'olx',
    olxCategory,
    ...overrides,
  };
}

const connected = [{ key: 'olx' as const, connected: true }];
const disconnected = [{ key: 'olx' as const, connected: false }];

function productDeps(calls: string[] = [], overrides: Partial<WizardProductDeps> = {}) {
  return {
    createProduct: jest.fn(async () => {
      calls.push('createProduct');
      return { id: 'p1' };
    }),
    rememberCreatedProduct: jest.fn((productId: string) => {
      calls.push(`remember:${productId}`);
    }),
    clearDraft: jest.fn(() => {
      calls.push('clearDraft');
    }),
    advanceJourney: jest.fn(async (...args: Parameters<typeof advancePublicationJourney>) => {
      calls.push('advanceJourney');
      return advancePublicationJourney(...args);
    }),
    checkTarget: jest.fn(async (): Promise<TargetConnection> => 'connected'),
    productExists: jest.fn(async () => true),
    ...overrides,
  };
}

describe('submitWizardProduct', () => {
  it('continues a resumed draft with its created product instead of creating another', async () => {
    const deps = productDeps();

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: 'p1', marketplaces: connected },
      deps,
    );

    expect(deps.createProduct).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('publish_started');
    if (outcome.kind !== 'publish_started') return;
    expect(outcome.productId).toBe('p1');
    expect(outcome.journey).toEqual({
      phase: 'product_saved',
      productId: 'p1',
      marketplaceKey: 'olx',
      providerCategoryId: '101',
      approvedInWizard: true,
    });
  });

  it('does not create a second product when a resumed draft is saved as a draft', async () => {
    const deps = productDeps();

    const outcome = await submitWizardProduct(
      submission({ intent: 'draft' }),
      { createdProductId: 'p1', marketplaces: connected },
      deps,
    );

    expect(deps.createProduct).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'draft_saved', productId: 'p1', marketplaceConnected: true });
    expect(deps.clearDraft).toHaveBeenCalledTimes(1);
  });

  it('remembers the created product before the journey advances and the draft is cleared', async () => {
    const calls: string[] = [];
    const deps = productDeps(calls);

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: null, marketplaces: connected },
      deps,
    );

    expect(outcome.kind).toBe('publish_started');
    expect(calls).toEqual(['createProduct', 'remember:p1', 'advanceJourney', 'clearDraft']);
    expect(deps.createProduct).toHaveBeenCalledWith(submission().values);
  });

  it('keeps the remembered product when advancing the journey fails', async () => {
    const calls: string[] = [];
    const failure = new Error('graph broke');
    const deps = productDeps(calls, {
      advanceJourney: jest.fn(async () => {
        throw failure;
      }),
    });

    await expect(
      submitWizardProduct(submission(), { createdProductId: null, marketplaces: connected }, deps),
    ).rejects.toBe(failure);
    expect(calls).toEqual(['createProduct', 'remember:p1']);
  });

  it('saves the product as a draft when the submit-time check finds OLX disconnected', async () => {
    const deps = productDeps([], { checkTarget: jest.fn(async () => 'disconnected' as const) });

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: null, marketplaces: connected },
      deps,
    );

    expect(deps.checkTarget).toHaveBeenCalledWith('olx');
    expect(outcome).toEqual({ kind: 'disconnected_saved_as_draft', productId: 'p1' });
    expect(deps.createProduct).toHaveBeenCalledTimes(1);
    expect(deps.advanceJourney).not.toHaveBeenCalled();
    expect(deps.clearDraft).toHaveBeenCalledTimes(1);
  });

  it('saves a draft without a journey and reports whether anything is connected', async () => {
    const calls: string[] = [];
    const deps = productDeps(calls);

    const outcome = await submitWizardProduct(
      submission({ intent: 'draft', targetMarketplace: null }),
      { createdProductId: null, marketplaces: [] },
      deps,
    );

    expect(outcome).toEqual({ kind: 'draft_saved', productId: 'p1', marketplaceConnected: false });
    expect(calls).toEqual(['createProduct', 'remember:p1', 'clearDraft']);
  });

  it('returns field errors without remembering the product or clearing the draft', async () => {
    const deps = productDeps([], {
      createProduct: jest.fn(async () => {
        throw {
          data: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid product',
              details: [{ field: 'name', message: 'Name is too long' }],
            },
          },
        };
      }),
    });

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: null, marketplaces: connected },
      deps,
    );

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.errors.fieldErrors).toEqual({ name: 'Name is too long' });
    expect(deps.rememberCreatedProduct).not.toHaveBeenCalled();
    expect(deps.clearDraft).not.toHaveBeenCalled();
  });

  it('rethrows a creation failure that has no field errors', async () => {
    const failure = new Error('Network down');
    const deps = productDeps([], {
      createProduct: jest.fn(async () => {
        throw failure;
      }),
    });

    await expect(
      submitWizardProduct(submission(), { createdProductId: null, marketplaces: connected }, deps),
    ).rejects.toBe(failure);
    expect(deps.rememberCreatedProduct).not.toHaveBeenCalled();
    expect(deps.clearDraft).not.toHaveBeenCalled();
  });
});

describe('submitWizardProduct connection check and resume', () => {
  it('checks the target at submit time and continues when it is connected', async () => {
    const deps = productDeps();

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: null, marketplaces: disconnected },
      deps,
    );

    expect(deps.checkTarget).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('publish_started');
  });

  it('does not claim a disconnect when the connection check is inconclusive', async () => {
    for (const checkTarget of [
      jest.fn(async () => 'unknown' as const),
      jest.fn(async (): Promise<TargetConnection> => {
        throw new Error('timeout');
      }),
    ]) {
      const deps = productDeps([], { checkTarget });

      const outcome = await submitWizardProduct(
        submission(),
        { createdProductId: null, marketplaces: undefined },
        deps,
      );

      expect(outcome.kind).toBe('publish_started');
      if (outcome.kind !== 'publish_started') return;
      expect(outcome.journey.marketplaceKey).toBe('olx');
    }
  });

  it('does not check the connection for a draft', async () => {
    const deps = productDeps();

    await submitWizardProduct(
      submission({ intent: 'draft' }),
      { createdProductId: null, marketplaces: connected },
      deps,
    );

    expect(deps.checkTarget).not.toHaveBeenCalled();
  });

  it('creates a new product when the remembered one no longer exists', async () => {
    const calls: string[] = [];
    const deps = productDeps(calls, {
      productExists: jest.fn(async () => false),
      createProduct: jest.fn(async () => {
        calls.push('createProduct');
        return { id: 'p2' };
      }),
    });

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: 'p1', marketplaces: connected },
      deps,
    );

    expect(deps.productExists).toHaveBeenCalledWith('p1');
    expect(calls).toEqual(['createProduct', 'remember:p2', 'advanceJourney', 'clearDraft']);
    expect(outcome).toMatchObject({ kind: 'publish_started', productId: 'p2' });
  });

  it('keeps the remembered product when its existence cannot be checked', async () => {
    const deps = productDeps([], {
      productExists: jest.fn(async () => {
        throw new Error('Network down');
      }),
    });

    const outcome = await submitWizardProduct(
      submission(),
      { createdProductId: 'p1', marketplaces: connected },
      deps,
    );

    expect(deps.createProduct).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'publish_started', productId: 'p1' });
  });
});
