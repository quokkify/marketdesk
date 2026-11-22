import type { ResearchRun, RunTrigger } from '../../../shared/types';

export type RunRequestReason = 'enqueued' | 'active' | 'not_due' | 'not_configured' | 'not_pln';

// The only way to start price research: the graph runs in a background job, never in the caller.
export interface IPriceResearchRuns {
  // force skips the next automatic run time; the limits still apply.
  request(
    workspaceId: string,
    productId: string,
    opts: { force: boolean; trigger: RunTrigger },
  ): Promise<{ run: ResearchRun | null; enqueued: boolean; reason: RunRequestReason }>;
  latest(workspaceId: string, productId: string): Promise<{ active: ResearchRun | null; last: ResearchRun | null }>;
}
