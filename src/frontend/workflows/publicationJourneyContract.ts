import type { MarketplaceKey } from '@shared/types';

export const PUBLICATION_JOURNEY_VERSION = 'publication-journey@2';

export const WIZARD_PHASES = ['photos', 'review'] as const;

export type WizardPhase = (typeof WIZARD_PHASES)[number];
export type PublicationPhase = WizardPhase | 'product_saved' | 'listing_draft' | 'publication_review' | 'blocked' | 'approved' | 'queued';

export interface PublicationJourneyState {
  phase: PublicationPhase;
  productId?: string;
  listingId?: string;
  marketplaceKey?: MarketplaceKey;
  publishAllowed?: boolean;
  quotaOverrideEligible?: boolean;
  providerCategoryId?: string;
  approvedInWizard?: boolean;
}

export function wizardPhaseAt(index: number): WizardPhase {
  return WIZARD_PHASES[index] ?? WIZARD_PHASES[0];
}

export function wizardStepIndex(phase: PublicationPhase): number {
  const index = WIZARD_PHASES.indexOf(phase as WizardPhase);
  if (index < 0) throw new Error(`${phase} is not a wizard step`);
  return index;
}
