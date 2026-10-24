import type {
  OlxPublicationQuota,
  OlxQuotaDecisionKind,
  OlxQuotaStatus,
} from '../../entities/OlxPublicationQuota';

export interface OlxQuotaLookup {
  workspaceId: string;
  marketplaceId: string;
  marketplaceAccountId: string;
  subcategoryId: string;
  at: Date;
}

export interface AuthorizeOlxPublicationInput extends OlxQuotaLookup {
  operationId: string;
  listingId: string;
  mode: 'publish' | 'relist' | 'recreate';
  overrideConfirmed: boolean;
  overrideReason?: string;
  actorId?: string;
  // While the OLX adapter is not real, a missing quota row allows publication without
  // consuming a unit (OLX_SANDBOX_QUOTA_EVALUATION).
  sandboxMode?: boolean;
}

export interface OlxPublicationAuthorization {
  operationId: string;
  decision: OlxQuotaDecisionKind;
  status: OlxQuotaStatus;
  reason: string;
  quota: OlxPublicationQuota | null;
  consumedUnit: boolean;
  replayed: boolean;
}

export interface IOlxPublicationQuotaRepository {
  findCurrent(input: OlxQuotaLookup): Promise<OlxPublicationQuota | null>;
  findByAccount(input: {
    workspaceId: string;
    marketplaceId: string;
    marketplaceAccountId: string;
    limit: number;
  }): Promise<OlxPublicationQuota[]>;
  save(quota: OlxPublicationQuota): Promise<void>;
  authorize(input: AuthorizeOlxPublicationInput): Promise<OlxPublicationAuthorization>;
  consume(operationId: string, at: Date, sandboxMode?: boolean): Promise<OlxPublicationAuthorization>;
}
