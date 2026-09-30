import {
  advancePublicationJourney,
} from './publicationJourneyGraph';
import { wizardPhaseAt, wizardStepIndex } from './publicationJourneyContract';

describe('publication journey graph', () => {
  it('walks from the product wizard through explicit review to a queued publication', async () => {
    let journey = { phase: 'photos' as const };
    for (let step = 0; step < 5; step += 1) {
      journey = await advancePublicationJourney(journey, { type: 'next', validated: true }) as typeof journey;
      expect(wizardStepIndex(journey.phase)).toBe(step + 1);
    }
    expect(wizardPhaseAt(5)).toBe('review');
    const saved = await advancePublicationJourney(journey, {
      type: 'product_created', productId: 'product-1', marketplaceKey: 'olx',
    });
    expect(saved).toMatchObject({ phase: 'product_saved', productId: 'product-1', marketplaceKey: 'olx' });
    const listing = await advancePublicationJourney(saved, { type: 'listing_created', listingId: 'listing-1' });
    const review = await advancePublicationJourney(listing, {
      type: 'preview_loaded', canPublish: true, quotaOverrideEligible: false,
    });
    const approved = await advancePublicationJourney(review, {
      type: 'approval_given', quotaOverrideConfirmed: false,
    });
    const queued = await advancePublicationJourney(approved, { type: 'publication_queued' });
    expect(queued).toMatchObject({ phase: 'queued', listingId: 'listing-1' });
  });

  it('cannot approve a blocked publication or skip owner review', async () => {
    const draft = { phase: 'listing_draft' as const, productId: 'product-1', listingId: 'listing-1' };
    const blocked = await advancePublicationJourney(draft, {
      type: 'preview_loaded', canPublish: false, quotaOverrideEligible: false,
    });
    expect(blocked.phase).toBe('blocked');
    await expect(advancePublicationJourney(blocked, {
      type: 'approval_given', quotaOverrideConfirmed: true,
    })).rejects.toThrow('Invalid publication journey transition');
    await expect(advancePublicationJourney(draft, { type: 'publication_queued' }))
      .rejects.toThrow('Invalid publication journey transition');
  });

  it('requires the fee-risk acknowledgement when quota override is eligible', async () => {
    const review = await advancePublicationJourney({ phase: 'listing_draft' }, {
      type: 'preview_loaded', canPublish: false, quotaOverrideEligible: true,
    });
    await expect(advancePublicationJourney(review, {
      type: 'approval_given', quotaOverrideConfirmed: false,
    })).rejects.toThrow('Publication cannot proceed');
    await expect(advancePublicationJourney(review, {
      type: 'approval_given', quotaOverrideConfirmed: true,
    })).resolves.toMatchObject({ phase: 'approved' });
  });
});
