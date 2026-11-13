// The steps that follow "Publish to OLX" in the product wizard, kept free of React so the
// pages only map outcomes to toasts, alerts, dialogs and navigation.
import type { Listing, Marketplace, MarketplaceKey } from '@shared/types';
import type { PublishListingInput, PublishListingPreview } from '../state/api/dto.js';
import { productFieldErrorsFromApi } from '../components/forms/productFormModel.js';
import type { ApiFieldErrors, ProductSubmissionValues } from '../components/forms/productFormModel.js';
import type { WizardSubmission } from '../components/forms/ProductWizardForm.js';
import type { PublicationJourneyState } from './publicationJourneyContract.js';
import { advancePublicationJourney } from './publicationJourneyGraph.js';

export interface CreationJourneyDeps {
  findListing: (marketplaceId: string) => Listing | undefined;
  createListing: (input: { productId: string; marketplaceKey: MarketplaceKey }) => Promise<Listing>;
  setCategory: (input: { id: string; providerCategoryId: string }) => Promise<Listing>;
  preview: (listingId: string) => Promise<PublishListingPreview>;
  publish: (input: PublishListingInput) => Promise<Listing>;
}

export type CreationJourneyOutcome =
  | { kind: 'queued'; listing: Listing; journey: PublicationJourneyState }
  | { kind: 'review'; listing: Listing; preview: PublishListingPreview; journey: PublicationJourneyState }
  | { kind: 'skipped'; reason: 'listing_not_draft' }
  | { kind: 'failed'; step: 'listing' | 'category' | 'preview' | 'publish'; error: unknown; listing?: Listing };

export async function runCreationJourney(
  pending: PublicationJourneyState,
  marketplace: Pick<Marketplace, 'id' | 'key'>,
  deps: CreationJourneyDeps,
): Promise<CreationJourneyOutcome> {
  let listing: Listing;
  let journey: PublicationJourneyState;
  try {
    if (!pending.productId) throw new Error('The publication journey has no product.');
    listing =
      deps.findListing(marketplace.id) ??
      (await deps.createListing({ productId: pending.productId, marketplaceKey: marketplace.key }));
    if (listing.status !== 'draft') return { kind: 'skipped', reason: 'listing_not_draft' };
    journey = await advancePublicationJourney(pending, { type: 'listing_created', listingId: listing.id });
  } catch (error) {
    return { kind: 'failed', step: 'listing', error };
  }

  const wantedCategoryId = pending.providerCategoryId;
  if (wantedCategoryId && listing.marketplaceCategory?.providerCategoryId !== wantedCategoryId) {
    try {
      listing = await deps.setCategory({ id: listing.id, providerCategoryId: wantedCategoryId });
    } catch (error) {
      return { kind: 'failed', step: 'category', error, listing };
    }
  }

  let preview: PublishListingPreview;
  try {
    preview = await deps.preview(listing.id);
    journey = await advancePublicationJourney(journey, {
      type: 'preview_loaded',
      canPublish: preview.canPublish,
      quotaOverrideEligible: preview.quotaOverrideEligibility.eligible,
    });
  } catch (error) {
    return { kind: 'failed', step: 'preview', error, listing };
  }

  const nothingBlocks =
    pending.approvedInWizard === true &&
    preview.canPublish === true &&
    preview.marketplaceCategory?.providerCategoryId === wantedCategoryId;
  if (!nothingBlocks) return { kind: 'review', listing, preview, journey };

  try {
    const approved = await advancePublicationJourney(journey, {
      type: 'approval_given',
      quotaOverrideConfirmed: false,
    });
    const published = await deps.publish({ id: listing.id });
    const queued = await advancePublicationJourney(approved, { type: 'publication_queued' });
    return { kind: 'queued', listing: published, journey: queued };
  } catch (error) {
    return { kind: 'failed', step: 'publish', error, listing };
  }
}

export interface WizardProductContext {
  // Set when an earlier attempt of this wizard draft already created the product.
  createdProductId: string | null;
  marketplaces: ReadonlyArray<Pick<Marketplace, 'key' | 'connected'>> | undefined;
}

export interface WizardProductDeps {
  createProduct: (values: ProductSubmissionValues) => Promise<{ id: string }>;
  rememberCreatedProduct: (productId: string) => void;
  clearDraft: () => void;
  advanceJourney: typeof advancePublicationJourney;
}

export type WizardProductOutcome =
  | { kind: 'draft_saved'; productId: string; marketplaceConnected: boolean }
  | { kind: 'publish_started'; productId: string; journey: PublicationJourneyState }
  | { kind: 'disconnected_saved_as_draft'; productId: string }
  | { kind: 'rejected'; errors: ApiFieldErrors };

// Rejects with the creation error when the API gave no field errors to show in the form.
export async function submitWizardProduct(
  submission: WizardSubmission,
  context: WizardProductContext,
  deps: WizardProductDeps,
): Promise<WizardProductOutcome> {
  let productId = context.createdProductId;
  // A retry continues with the product already created; values edited since are not re-sent.
  if (!productId) {
    try {
      productId = (await deps.createProduct(submission.values)).id;
    } catch (error) {
      const rejected = productFieldErrorsFromApi(error);
      if (Object.keys(rejected.fieldErrors).length > 0) return { kind: 'rejected', errors: rejected };
      throw error;
    }
    deps.rememberCreatedProduct(productId);
  }

  const target = submission.targetMarketplace
    ? context.marketplaces?.find(
        (marketplace) => marketplace.key === submission.targetMarketplace && marketplace.connected,
      )
    : undefined;

  if (submission.intent === 'draft') {
    deps.clearDraft();
    const marketplaceConnected = Boolean(context.marketplaces?.some((marketplace) => marketplace.connected));
    return { kind: 'draft_saved', productId, marketplaceConnected };
  }
  if (!target) {
    deps.clearDraft();
    return { kind: 'disconnected_saved_as_draft', productId };
  }

  const journey = await deps.advanceJourney(
    { phase: 'review' },
    {
      type: 'product_created',
      productId,
      marketplaceKey: target.key,
      providerCategoryId: submission.olxCategory?.providerCategoryId,
      approvedInWizard: true,
    },
  );
  deps.clearDraft();
  return { kind: 'publish_started', productId, journey };
}
