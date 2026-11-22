import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import { TooManyRequestsError } from '../../../domain/shared/DomainError';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { IPriceResearchRuns } from '../../../domain/ports/IPriceResearchRuns';
import type { PriceEstimateService, PriceSuggestion } from '../../../domain/services/PriceEstimateService';
import {
  aiAnswersOffline,
  withOfflineNotice,
  PRICE_ESTIMATE_PENDING,
  PRICE_EVENT_TYPES,
  PRICE_NOTICE_TYPES,
  type HermesEngineLogger,
  type IdFactory,
} from '../../../domain/services/proposalSupport';
import type { HermesEventType, RunOutcome, StoredPriceEstimate } from '../../../../shared/types';

const RESEARCH_UNAVAILABLE_NOTE = 'Market research failed; the estimate uses saved data.';

export interface PriceProposalsDeps {
  products: IProductRepository;
  listings: IListingRepository;
  events: IEventRepository;
  estimates: PriceEstimateService;
  runs: IPriceResearchRuns | null;
  ai: object;
  idFactory: IdFactory;
  logger?: HermesEngineLogger;
}

export interface PriceVerdictProposal {
  skipped: 'research_pending' | null;
  stored: StoredPriceEstimate | null;
  suggestionType: HermesEventType | null;
  eventIds: string[];
}

export class PriceProposals {
  constructor(private readonly deps: PriceProposalsDeps) {}

  // Asks for a background research run when one is due and never waits for it: the estimate uses
  // the stored research. A run that could not even be requested is noted on the estimate.
  async requestResearch(product: Product): Promise<string | null> {
    if (!this.deps.runs) return null;
    try {
      await this.deps.runs.request(product.workspaceId, product.id, { force: false, trigger: 'analyze' });
      return null;
    } catch (error) {
      // A full workspace queue means the research was not started, not that it failed.
      if (error instanceof TooManyRequestsError) {
        this.deps.logger?.warn({ productId: product.id }, 'Price research not started: the workspace queue is full');
        return null;
      }
      this.deps.logger?.warn({ productId: product.id, err: error }, 'Requesting price research failed');
      return RESEARCH_UNAVAILABLE_NOTE;
    }
  }

  async proposeForVerdict(
    product: Product,
    primary: Listing,
    opts?: { researchNote?: string | null },
  ): Promise<PriceVerdictProposal> {
    const { event, ...result } = await this.proposeWithEvent(product, primary, opts);
    return { ...result, eventIds: event ? [event.id] : [] };
  }

  /** As proposeForVerdict, returning the saved event itself. */
  async proposeWithEvent(
    product: Product,
    primary: Listing,
    opts?: { researchNote?: string | null },
  ): Promise<Omit<PriceVerdictProposal, 'eventIds'> & { event: HermesEvent | null }> {
    // The source is asked before and after the estimate call, as for the SEO call.
    const offlineBefore = await aiAnswersOffline(this.deps.ai);
    const { suggestion, stored, skipped } = await this.deps.estimates.estimate(product, primary, {
      researchNote: opts?.researchNote,
    });
    const chosen = skipped === 'research_pending' ? PRICE_ESTIMATE_PENDING : suggestion;
    const event = chosen ? await this.savePriceEvent(product, chosen, offlineBefore) : null;
    return { skipped, stored, suggestionType: chosen?.type ?? null, event };
  }

  /**
   * The research job's re-estimate: estimates from the stored research without requesting a run or
   * running SEO (the job's own run may still be active), and replaces the product's pending price
   * event (an "unavailable" result replaces only earlier notices). A stored estimate not worth
   * surfacing still closes the pending ones: they predate the research the job just stored. An estimate refused as stale closes nothing. Null when
   * the product or its listing is gone, or nothing is surfaced.
   */
  async reestimatePrice(workspaceId: string, productId: string): Promise<HermesEvent | null> {
    const product = await this.deps.products.findByIdForWorkspace(productId, workspaceId);
    if (!product) return null;
    const [primary] = await this.deps.listings.findByProduct(product.id);
    if (!primary) return null;
    const offlineBefore = await aiAnswersOffline(this.deps.ai);
    const { suggestion, stored } = await this.deps.estimates.estimate(product, primary, { ignoreActiveRun: true });
    if (suggestion) {
      const supersedes = suggestion.type === 'price_estimate_unavailable' ? PRICE_NOTICE_TYPES : PRICE_EVENT_TYPES;
      return this.savePriceEvent(product, suggestion, offlineBefore, supersedes);
    }
    if (stored === null) return null;
    await this.closePendingPriceEvents(product, PRICE_EVENT_TYPES);
    return null;
  }

  /**
   * Re-estimates after a finished research run when the estimate may be out of date or a notice is
   * waiting for it: the run threw, timed out or expired (no run result), failed, changed the ladder,
   * left a pending "unavailable" notice, or no estimate is stored yet. Null when nothing is surfaced.
   */
  async reestimateAfterResearch(
    workspaceId: string,
    productId: string,
    run: { outcome: RunOutcome; rowsChanged: boolean } | null,
  ): Promise<HermesEvent | null> {
    const due =
      run === null ||
      run.outcome === 'failed' ||
      run.rowsChanged ||
      (await this.deps.events.findPendingByProduct(workspaceId, productId, PRICE_NOTICE_TYPES)).length > 0 ||
      !(await this.deps.estimates.hasStoredEstimate(workspaceId, productId));
    return due ? this.reestimatePrice(workspaceId, productId) : null;
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
