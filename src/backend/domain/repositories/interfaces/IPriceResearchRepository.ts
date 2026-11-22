import type { PriceComparable, PriceResearch, StoredPriceEstimate } from '../../../../shared/types';

export interface IPriceResearchRepository {
  findByProduct(workspaceId: string, productId: string): Promise<PriceResearch | null>;
  // Null when baseUpdatedAt is given and the stored row has moved on since (null base: a row now exists).
  upsert(
    workspaceId: string,
    research: Omit<PriceResearch, 'updatedAt' | 'specs' | 'lastAttemptAt' | 'lastEstimate'>,
    baseUpdatedAt?: string | null,
  ): Promise<PriceResearch | null>;
  saveLadder(
    workspaceId: string,
    productId: string,
    ladder: { comparables: PriceComparable[]; specs: string | null; attemptedAt: string },
  ): Promise<PriceResearch>;
  markAttempt(workspaceId: string, productId: string, attemptedAt: string): Promise<void>;
  saveEstimate(workspaceId: string, productId: string, stored: StoredPriceEstimate): Promise<void>;
}
