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
  // Defaults to the publication journey graph; injectable for tests.
  advance?: typeof advancePublicationJourney;
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
  const advance = deps.advance ?? advancePublicationJourney;
  let listing: Listing;
  let journey: PublicationJourneyState;
  try {
    if (!pending.productId) throw new Error('The publication journey has no product.');
    listing =
      deps.findListing(marketplace.id) ??
      (await deps.createListing({ productId: pending.productId, marketplaceKey: marketplace.key }));
    if (listing.status !== 'draft') return { kind: 'skipped', reason: 'listing_not_draft' };
    journey = await advance(pending, { type: 'listing_created', listingId: listing.id });
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
    journey = await advance(journey, {
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
    Boolean(wantedCategoryId) &&
    preview.marketplaceCategory?.providerCategoryId === wantedCategoryId;
  if (!nothingBlocks) return { kind: 'review', listing, preview, journey };

  let approved: PublicationJourneyState;
  let published: Listing;
  try {
    approved = await advance(journey, { type: 'approval_given', quotaOverrideConfirmed: false });
    published = await deps.publish({ id: listing.id });
  } catch (error) {
    return { kind: 'failed', step: 'publish', error, listing };
  }
  // The server accepted the publication, so a retry must not be offered.
  const queued = await advance(approved, { type: 'publication_queued' }).catch(
    (): PublicationJourneyState => ({ ...approved, phase: 'queued' }),
  );
  return { kind: 'queued', listing: published, journey: queued };
}

export interface WizardProductContext {
  // Set when an earlier attempt of this wizard draft already created the product.
  createdProductId: string | null;
  marketplaces: ReadonlyArray<Pick<Marketplace, 'key' | 'connected'>> | undefined;
}

// `unknown` means the check itself failed; it is never reported as a disconnect.
export type TargetConnection = 'connected' | 'disconnected' | 'unknown';

// A hung check must not leave "Publish to OLX" waiting forever.
export const CONNECTION_CHECK_TIMEOUT_MS = 5000;

function checkTargetWithTimeout(
  check: Promise<TargetConnection>,
): Promise<TargetConnection> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TargetConnection>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), CONNECTION_CHECK_TIMEOUT_MS);
  });
  return Promise.race([check.catch((): TargetConnection => 'unknown'), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

export interface WizardProductDeps {
  createProduct: (values: ProductSubmissionValues) => Promise<{ id: string }>;
  // False only when the server says the product is gone.
  productExists: (productId: string) => Promise<boolean>;
  checkTarget: (marketplaceKey: MarketplaceKey) => Promise<TargetConnection>;
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
  if (productId && !(await deps.productExists(productId).catch(() => true))) productId = null;
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

  if (submission.intent === 'draft') {
    deps.clearDraft();
    const marketplaceConnected = Boolean(context.marketplaces?.some((marketplace) => marketplace.connected));
    return { kind: 'draft_saved', productId, marketplaceConnected };
  }
  const target = submission.targetMarketplace;
  const connection: TargetConnection = target
    ? await checkTargetWithTimeout(Promise.resolve().then(() => deps.checkTarget(target)))
    : 'disconnected';
  if (!target || connection === 'disconnected') {
    deps.clearDraft();
    return { kind: 'disconnected_saved_as_draft', productId };
  }

  const journey = await deps.advanceJourney(
    { phase: 'review' },
    {
      type: 'product_created',
      productId,
      marketplaceKey: target,
      providerCategoryId: submission.olxCategory?.providerCategoryId,
      approvedInWizard: true,
    },
  );
  deps.clearDraft();
  return { kind: 'publish_started', productId, journey };
}
