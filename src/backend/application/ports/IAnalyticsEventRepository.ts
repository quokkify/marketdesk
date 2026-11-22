export type AnalyticsEventType = 'view' | 'message' | 'sale';

export interface AnalyticsEventRecord {
  id: string;
  workspaceId: string;
  listingId: string | null;
  marketplaceId: string | null;
  currency: string | null;
  eventType: AnalyticsEventType;
  quantity: number;
  amount: number | null;
  costAtSale: number | null;
  occurredAt: Date;
}

export interface AnalyticsEventQuery {
  workspaceId: string;
  from: Date;
  to: Date;
  marketplaceId?: string;
}

export interface AppendAnalyticsEvent {
  idempotencyKey: string;
  workspaceId: string;
  listingId: string;
  marketplaceId: string;
  eventType: AnalyticsEventType;
  quantity: number;
  amount: number | null;
  costAtSale: number | null;
  currency: string | null;
  occurredAt: Date;
}

export interface IAnalyticsEventRepository {
  findByRange(query: AnalyticsEventQuery): Promise<AnalyticsEventRecord[]>;
  appendMany(events: AppendAnalyticsEvent[]): Promise<void>;
  /** Id of each listing's earliest view event: it holds the pre-tracking total, not growth. */
  baselineViewEventIds(workspaceId: string): Promise<Set<string>>;
}
