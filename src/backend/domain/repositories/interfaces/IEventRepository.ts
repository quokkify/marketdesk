import type { HermesEvent } from '../../entities/HermesEvent';
import type { HermesEventStatus, HermesEventType } from '../../../../shared/types';
import type { AgentRecommendationRecord } from '../../agents/MarketDeskAgentCatalog';

export interface IEventRepository {
  findById(id: string): Promise<HermesEvent | null>;
  // Tenant-scoped read. Null when the event belongs to another workspace (S2).
  findByIdForWorkspace(id: string, workspaceId: string): Promise<HermesEvent | null>;
  findByWorkspace(workspaceId: string): Promise<HermesEvent[]>;
  findByStatus(workspaceId: string, status: HermesEventStatus): Promise<HermesEvent[]>;
  findPendingReview(workspaceId: string): Promise<HermesEvent[]>;
  /** The product's pending_review events of the given types. */
  findPendingByProduct(workspaceId: string, productId: string, types: readonly HermesEventType[]): Promise<HermesEvent[]>;
  /**
   * Dismisses the product's events of the given types that are still pending_review when the write
   * runs; an event resolved meanwhile is left as it is. Returns how many were dismissed.
   */
  dismissPendingByProduct(
    workspaceId: string,
    productId: string,
    types: readonly HermesEventType[],
    resolvedAt: Date,
  ): Promise<number>;
  save(event: HermesEvent): Promise<void>;
  /** Atomically inserts a semantic recommendation once. */
  saveRecommendationIfAbsent(event: HermesEvent, idempotencyKey: string): Promise<boolean>;
  /** Atomically inserts a review event and its structured agent provenance once. */
  saveAgentRecommendationIfAbsent(
    event: HermesEvent,
    idempotencyKey: string,
    recommendation: AgentRecommendationRecord,
  ): Promise<boolean>;
  hasRecentAgentRecommendation(
    workspaceId: string,
    productId: string,
    agentId: 'listing-seo',
    agentVersion: string,
    sourceFingerprint: string,
    recommendationFingerprint: string,
    since: Date,
  ): Promise<boolean>;
  recordAgentRecommendationOutcome(recommendation: AgentRecommendationRecord): Promise<void>;
  findAgentRecommendationByEvent(
    workspaceId: string,
    eventId: string,
  ): Promise<AgentRecommendationRecord | null>;
  markAgentRecommendationApproved(workspaceId: string, eventId: string, at: Date): Promise<void>;
  markAgentRecommendationDismissed(workspaceId: string, eventId: string, at: Date): Promise<void>;
  markAgentRecommendationApplied(workspaceId: string, eventId: string, at: Date): Promise<void>;
  markAgentRecommendationFailed(workspaceId: string, eventId: string, at: Date): Promise<void>;
  saveAll(events: HermesEvent[]): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<void>;
}
