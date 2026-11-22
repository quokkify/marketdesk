export type LadderOutcome = 'refreshed' | 'fresh' | 'not_configured' | 'not_pln' | 'unavailable';

export interface IPriceResearchRefresher {
  // Refreshes a stale ladder; never throws.
  refreshIfStale(workspaceId: string, productId: string): Promise<LadderOutcome>;
}
