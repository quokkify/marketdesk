import type {
  AnchorTier,
  NodeStatus,
  ResearchNode,
  ResearchRun,
  RunOutcome,
  RunTrigger,
} from '../../../../shared/types';

export interface NewResearchRun {
  id: string;
  workspaceId: string;
  productId: string;
  trigger: RunTrigger;
  queuedAt: string;
}

export interface FinishedRunFields {
  outcome: RunOutcome;
  nodes: Partial<Record<ResearchNode, NodeStatus>>;
  failedTiers: AnchorTier[];
  errorCode: string | null;
  consecutiveFailures: number;
  finishedAt: string;
  nextAutoAt: string | null;
}

// Run state of the price research job. A product has at most one queued or running run (a partial
// unique index); writes here never touch product_price_research.
export interface IPriceResearchRunRepository {
  // Null when the product already has a queued or running run.
  insertQueued(run: NewResearchRun): Promise<ResearchRun | null>;
  findActive(workspaceId: string, productId: string): Promise<ResearchRun | null>;
  findLastFinished(workspaceId: string, productId: string): Promise<ResearchRun | null>;
  // Every run of the product, whatever its status, newest queued_at first.
  listForProduct(workspaceId: string, productId: string, limit: number): Promise<ResearchRun[]>;
  // queued → running for this run only; null when the run is no longer queued.
  claim(runId: string, startedAt: string, leaseUntil: string): Promise<ResearchRun | null>;
  saveNode(runId: string, node: ResearchNode, status: NodeStatus): Promise<void>;
  // queued or running → finished; false when the run already finished (e.g. its expired lease was written).
  finish(runId: string, fields: FinishedRunFields): Promise<boolean>;
}
