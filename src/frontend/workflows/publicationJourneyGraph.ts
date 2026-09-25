import type { MarketplaceKey } from '@shared/types';
import { WIZARD_PHASES } from './publicationJourneyContract.js';
import type { PublicationJourneyState, WizardPhase } from './publicationJourneyContract.js';

export type PublicationJourneyEvent =
  | { type: 'next'; validated: true }
  | { type: 'back' }
  | { type: 'product_created'; productId: string; marketplaceKey: MarketplaceKey }
  | { type: 'listing_created'; listingId: string }
  | { type: 'preview_loaded'; canPublish: boolean; quotaOverrideEligible: boolean }
  | { type: 'approval_given'; quotaOverrideConfirmed: boolean }
  | { type: 'publication_queued' };

function requirePhase(state: PublicationJourneyState, phase: PublicationJourneyState['phase']) {
  if (state.phase !== phase) {
    throw new Error(`Invalid publication journey transition from ${state.phase}; expected ${phase}`);
  }
}

// Presentation graph: one validated edge per user/domain event. The backend owns
// all durable facts and performs the real publication graph and policy checks.
export async function advancePublicationJourney(
  state: PublicationJourneyState,
  event: PublicationJourneyEvent,
): Promise<PublicationJourneyState> {
  switch (event.type) {
    case 'next': {
      const index = WIZARD_PHASES.indexOf(state.phase as WizardPhase);
      if (!event.validated || index < 0 || index >= WIZARD_PHASES.length - 1) {
        throw new Error(`Cannot continue publication journey from ${state.phase}`);
      }
      return { ...state, phase: WIZARD_PHASES[index + 1] };
    }
    case 'back': {
      const index = WIZARD_PHASES.indexOf(state.phase as WizardPhase);
      if (index <= 0) throw new Error(`Cannot go back from ${state.phase}`);
      return { ...state, phase: WIZARD_PHASES[index - 1] };
    }
    case 'product_created':
      requirePhase(state, 'review');
      if (!event.productId.trim()) throw new Error('Created product ID is required');
      return { ...state, phase: 'product_saved', productId: event.productId, marketplaceKey: event.marketplaceKey };
    case 'listing_created':
      requirePhase(state, 'product_saved');
      if (!event.listingId.trim()) throw new Error('Created listing ID is required');
      return { ...state, phase: 'listing_draft', listingId: event.listingId };
    case 'preview_loaded':
      requirePhase(state, 'listing_draft');
      return {
        ...state,
        phase: event.canPublish || event.quotaOverrideEligible ? 'publication_review' : 'blocked',
        publishAllowed: event.canPublish,
        quotaOverrideEligible: event.quotaOverrideEligible,
      };
    case 'approval_given':
      requirePhase(state, 'publication_review');
      if (!state.publishAllowed && !(state.quotaOverrideEligible && event.quotaOverrideConfirmed)) {
        throw new Error('Publication cannot proceed without an eligible preview and required approval');
      }
      return { ...state, phase: 'approved' };
    case 'publication_queued':
      requirePhase(state, 'approved');
      return { ...state, phase: 'queued' };
  }
}
