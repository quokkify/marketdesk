import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { IAIProvider, AIProviderSourceAware } from '../../../domain/ports/IAIProvider';
import type { PriceEstimateService, PriceSuggestion } from '../../../domain/services/PriceEstimateService';
import {
  aiAnswersOffline,
  withOfflineNotice,
  PRICE_ESTIMATE_PENDING,
  PRICE_EVENT_TYPES,
  type IdFactory,
} from '../../../domain/services/proposalSupport';
import type { HermesEventType, StoredPriceEstimate } from '../../../../shared/types';

export interface PriceProposalsDeps {
  events: IEventRepository;
  estimates: PriceEstimateService;
  ai: IAIProvider & Partial<AIProviderSourceAware>;
  idFactory: IdFactory;
}

export interface PriceVerdictProposal {
  skipped: 'research_pending' | null;
  stored: StoredPriceEstimate | null;
  suggestionType: HermesEventType | null;
  eventIds: string[];
}

export class PriceProposals {
  constructor(private readonly deps: PriceProposalsDeps) {}

  async proposeForVerdict(product: Product, primary: Listing): Promise<PriceVerdictProposal> {
    // The source is asked before and after the estimate call, as for the SEO call.
    const offlineBefore = await aiAnswersOffline(this.deps.ai);
    const { suggestion, stored, skipped } = await this.deps.estimates.estimate(product, primary);
    const chosen = skipped === 'research_pending' ? PRICE_ESTIMATE_PENDING : suggestion;
    const event = chosen ? await this.savePriceEvent(product, chosen, offlineBefore) : null;
    return { skipped, stored, suggestionType: chosen?.type ?? null, eventIds: event ? [event.id] : [] };
  }

  // Review-only like the SEO suggestions; an "unavailable" notice is no AI-made change. The product's
  // earlier pending events of the superseded types are closed in the same save.
  private async savePriceEvent(
    product: Product,
    suggestion: PriceSuggestion,
    offlineBefore: boolean,
    supersedes: readonly HermesEventType[] = PRICE_EVENT_TYPES,
  ): Promise<HermesEvent | null> {
    const source =
      suggestion.change === null
        ? null
        : offlineBefore || (await aiAnswersOffline(this.deps.ai))
          ? 'offline'
          : 'hermes';
    const created = HermesEvent.create({
      id: this.deps.idFactory(),
      workspaceId: product.workspaceId,
      productId: product.id,
      type: suggestion.type,
      severity: suggestion.severity,
      title: suggestion.title,
      detail: source === 'offline' ? withOfflineNotice(suggestion.detail) : suggestion.detail,
      proposedChange: suggestion.change,
      status: 'pending_review',
      autonomyDecision: 'pending_review',
      source,
    });
    if (created.isErr()) return null;
    await this.closePendingPriceEvents(product, supersedes);
    await this.deps.events.saveAll([created.value]);
    return created.value;
  }

  // Dismisses the product's events of the given types that are still pending when the write runs.
  private async closePendingPriceEvents(product: Product, types: readonly HermesEventType[]): Promise<void> {
    await this.deps.events.dismissPendingByProduct(product.workspaceId, product.id, types, new Date());
  }
}
