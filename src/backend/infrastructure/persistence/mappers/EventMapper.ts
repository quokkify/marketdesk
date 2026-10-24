import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type {
  AIProviderSource,
  AutonomyDecision,
  HermesEventStatus,
  HermesEventType,
  HermesSeverity,
} from '../../../../shared/types';
import type { HermesEventRow } from './rows';
import { toDate, toNullableDate, unwrapPersisted } from './support';

export const EventMapper = {
  toDomain(row: HermesEventRow): HermesEvent {
    return unwrapPersisted(
      HermesEvent.create({
        id: row.id,
        workspaceId: row.workspace_id,
        productId: row.product_id,
        type: row.type as HermesEventType,
        severity: row.severity as HermesSeverity,
        status: row.status as HermesEventStatus,
        title: row.title,
        detail: row.detail,
        proposedChange: row.proposed_change,
        autonomyDecision: row.autonomy_decision as AutonomyDecision | null,
        createdAt: toDate(row.created_at),
        resolvedAt: toNullableDate(row.resolved_at),
        source: row.source as AIProviderSource | null,
      }),
    );
  },
};
