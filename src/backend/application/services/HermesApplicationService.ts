// Application service (facade) for Hermes workflows: approve/dismiss events and expose
// paginated event queries for controllers.

import { Result, Ok } from '../../domain/shared/Result';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { HermesEventStatus, PaginatedResponse } from '../../../shared/types';
import { ApproveHermesEventUseCase } from '../usecases/ApproveHermesEventUseCase';
import { DismissHermesEventUseCase } from '../usecases/DismissHermesEventUseCase';
import type { ListEventsQueryDTO } from '../dto/HermesDTO';
import type { ApproveEventDTO, DismissEventDTO } from '../dto/ApproveEventDTO';
import { presentHermesEvent, type HermesEventView } from '../dto/presenters';
import { normalizeLimit, normalizeOffset, paginate } from '../dto/pagination';

export class HermesApplicationService {
  constructor(
    private readonly eventRepo: IEventRepository,
    private readonly approveEventUseCase: ApproveHermesEventUseCase,
    private readonly dismissEventUseCase: DismissHermesEventUseCase,
  ) {}

  async approveEvent(dto: ApproveEventDTO): Promise<Result<HermesEventView>> {
    const result = await this.approveEventUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentHermesEvent(result.value));
  }

  async dismissEvent(dto: DismissEventDTO): Promise<Result<HermesEventView>> {
    const result = await this.dismissEventUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentHermesEvent(result.value));
  }

  async listEvents(
    query: ListEventsQueryDTO,
  ): Promise<PaginatedResponse<HermesEventView>> {
    // Single-status fast path uses the indexed repository query; multi-status or
    // severity filters fetch the workspace's events and filter in memory (there
    // is no composite index for these yet).
    const statuses = query.status;
    const severities = query.severity;
    let events =
      statuses && statuses.length === 1
        ? await this.eventRepo.findByStatus(query.workspaceId, statuses[0])
        : await this.eventRepo.findByWorkspace(query.workspaceId);

    if (statuses && statuses.length > 1) {
      events = events.filter((e) => statuses.includes(e.status));
    }
    if (severities && severities.length > 0) {
      events = events.filter((e) => severities.includes(e.severity));
    }
    if (query.productId) {
      events = events.filter((e) => e.productId === query.productId);
    }

    const sorted = [...events].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return paginate(
      sorted,
      normalizeOffset(query.offset),
      normalizeLimit(query.limit),
      presentHermesEvent,
    );
  }

  async getPendingReview(workspaceId: string): Promise<HermesEventView[]> {
    const events = await this.eventRepo.findPendingReview(workspaceId);
    return events.map(presentHermesEvent);
  }

  // Pending suggestions per product, for the catalogue's "N to review" (products without any are absent).
  async pendingCountsByProduct(workspaceId: string): Promise<Record<string, number>> {
    const events = await this.eventRepo.findPendingReview(workspaceId);
    const counts: Record<string, number> = {};
    for (const event of events) {
      if (event.productId) counts[event.productId] = (counts[event.productId] ?? 0) + 1;
    }
    return counts;
  }

  async getEvent(id: string, workspaceId: string): Promise<HermesEventView | null> {
    // Tenant-scoped so a cross-workspace id reads as not-found (S2).
    const event = await this.eventRepo.findByIdForWorkspace(id, workspaceId);
    return event ? presentHermesEvent(event) : null;
  }

  // Convenience passthrough for controllers needing the raw status filter type.
  statuses(): readonly HermesEventStatus[] {
    return ['pending_review', 'applied', 'dismissed'];
  }
}
