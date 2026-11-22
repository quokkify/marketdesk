import type { ResearchRun } from '../../../shared/types';

// Reads price research runs. They are started only by the sale verdict's price check.
export interface IPriceResearchRuns {
  latest(workspaceId: string, productId: string): Promise<{ active: ResearchRun | null; last: ResearchRun | null }>;
}
