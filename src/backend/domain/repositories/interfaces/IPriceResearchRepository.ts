import type { PriceResearch } from '../../../../shared/types';

export interface IPriceResearchRepository {
  findByProduct(workspaceId: string, productId: string): Promise<PriceResearch | null>;
  upsert(workspaceId: string, research: Omit<PriceResearch, 'updatedAt'>): Promise<PriceResearch>;
}
