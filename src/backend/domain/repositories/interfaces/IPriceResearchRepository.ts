import type { PriceComparable, PriceResearch, StoredPriceEstimate } from '../../../../shared/types';

export type PriceResearchEdit = Omit<PriceResearch, 'updatedAt' | 'specs' | 'lastAttemptAt' | 'lastEstimate'>;

// The locked saves hold the research row (SELECT … FOR UPDATE) from reading it to writing it, so a
// ladder save and a seller edit never overwrite each other's rows or dismissals.
export interface IPriceResearchRepository {
  findByProduct(workspaceId: string, productId: string): Promise<PriceResearch | null>;
  // The seller's edit: apply sees the current row under the lock and may throw to refuse (nothing written).
  saveEditLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => PriceResearchEdit,
  ): Promise<PriceResearch>;
  // A research run's ladder: apply merges into the current row under the lock; null from apply writes nothing.
  // Returns the stored row afterwards, or null when there is none (also when the product is gone).
  saveLadderLocked(
    workspaceId: string,
    productId: string,
    apply: (current: PriceResearch | null) => { comparables: PriceComparable[]; specs: string | null } | null,
  ): Promise<PriceResearch | null>;
  markAttempt(workspaceId: string, productId: string, attemptedAt: string): Promise<void>;
  saveEstimate(workspaceId: string, productId: string, stored: StoredPriceEstimate): Promise<void>;
}
