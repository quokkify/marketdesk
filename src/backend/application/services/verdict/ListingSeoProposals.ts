import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { Product } from '../../../domain/entities/Product';
import type { Listing } from '../../../domain/entities/Listing';
import type { Workspace } from '../../../domain/entities/Workspace';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import type { IAIProvider } from '../../../domain/ports/IAIProvider';
import {
  listingSeoProfile,
  listingSeoInputSchema,
  recommendationFingerprint,
  rawSeoSourceFingerprint,
  seoSourceFingerprint,
  type AgentRecommendationRecord,
} from '../../../domain/agents/MarketDeskAgentCatalog';
import {
  aiAnswersOffline,
  withOfflineNotice,
  type HermesEngineLogger,
  type IdFactory,
} from '../../../domain/services/proposalSupport';
import type { AIProviderSource, HermesEventType } from '../../../../shared/types';

export interface ListingSeoProposalsDeps {
  products: IProductRepository;
  listings: IListingRepository;
  events: IEventRepository;
  ai: Pick<IAIProvider, 'analyzeListingSeo'>;
  idFactory: IdFactory;
  logger?: HermesEngineLogger;
}

/** Listing SEO proposals: always review-only and never auto-applied. */
export class ListingSeoProposals {
  constructor(private readonly deps: ListingSeoProposalsDeps) {}

  async propose(workspace: Workspace, product: Product, primary: Listing | null): Promise<HermesEvent[]> {
    const rawInput = {
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        condition: product.condition,
        tags: [...product.tags],
        imageCount: product.imageCount,
      },
      listing: primary
        ? {
            id: primary.id,
            title: product.name,
            description: product.description,
            marketplace: primary.marketplaceId,
          }
        : null,
    };
    let source = rawSeoSourceFingerprint(rawInput);
    let input: ReturnType<typeof listingSeoInputSchema.parse>;
    let output: Awaited<ReturnType<IAIProvider['analyzeListingSeo']>>;
    let aiSource: AIProviderSource;
    try {
      input = listingSeoInputSchema.parse(rawInput);
      source = seoSourceFingerprint(input);
      // Asked before and after the call, as in run(): any offline answer labels the events.
      const offlineBefore = await aiAnswersOffline(this.deps.ai);
      output = await this.deps.ai.analyzeListingSeo(input, workspace.creativityPreset);
      aiSource = offlineBefore || (await aiAnswersOffline(this.deps.ai)) ? 'offline' : 'hermes';
    } catch (error) {
      await this.deps.events.recordAgentRecommendationOutcome({
        id: this.deps.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        eventId: null,
        agentId: listingSeoProfile.id,
        agentVersion: listingSeoProfile.version,
        creativityPreset: workspace.creativityPreset,
        sourceFingerprint: source,
        recommendationFingerprint: recommendationFingerprint(
          listingSeoProfile.id,
          listingSeoProfile.version,
          source,
          'analysis_failed',
        ),
        outcome: 'failed',
        suggestedAt: new Date(),
      });
      throw error;
    }
    const events: HermesEvent[] = [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const windowStart = Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));

    for (const recommendation of output.recommendations) {
      const fingerprint = recommendationFingerprint(
        listingSeoProfile.id,
        listingSeoProfile.version,
        source,
        recommendation.proposedValue
      );
      const duplicate = await this.deps.events.hasRecentAgentRecommendation(
        workspace.id,
        product.id,
        listingSeoProfile.id,
        listingSeoProfile.version,
        source,
        fingerprint,
        new Date(cutoff),
      );
      if (duplicate) {
        await this.deps.events.recordAgentRecommendationOutcome(agentRecommendationRecord({
          id: this.deps.idFactory(),
          workspace,
          productId: product.id,
          eventId: null,
          source,
          fingerprint,
          outcome: 'suppressed',
        }));
        continue;
      }
      const proposedChange =
        recommendation.field === 'description'
          ? {
              kind: 'description' as const,
              field: 'description' as const,
              from: product.description,
              to: recommendation.proposedValue,
            }
          : {
              kind: 'title' as const,
              field: 'title' as const,
              from: product.name,
              to: recommendation.proposedValue,
            };
      const type: HermesEventType =
        recommendation.field === 'description'
          ? 'update_description'
          : 'suggested_better_title';
      // Fingerprints, source and ids stay in the agent recommendation record, not in seller copy.
      const detail = `${recommendation.rationale} Review-only suggestion from listing-seo@${listingSeoProfile.version} (${workspace.creativityPreset}). This may improve discoverability but does not guarantee a sale.`;
      const created = HermesEvent.create({
        id: this.deps.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type,
        severity: 'info',
        title: `Listing SEO suggestion: ${recommendation.field}`,
        detail: aiSource === 'offline' ? withOfflineNotice(detail) : detail,
        proposedChange,
        status: 'pending_review',
        autonomyDecision: 'pending_review',
        source: aiSource,
      });
      if (created.isErr()) continue;
      const event = created.value;
      const inserted = await this.deps.events.saveAgentRecommendationIfAbsent(
        event,
        `listing-seo:${listingSeoProfile.version}:${product.id}:${source}:${fingerprint}:w${windowStart}`,
        agentRecommendationRecord({
          id: this.deps.idFactory(),
          workspace,
          productId: product.id,
          eventId: event.id,
          source,
          fingerprint,
          outcome: 'suggested',
        }),
      );
      if (inserted) {
        events.push(event);
      } else {
        await this.deps.events.recordAgentRecommendationOutcome(agentRecommendationRecord({
          id: this.deps.idFactory(),
          workspace,
          productId: product.id,
          eventId: null,
          source,
          fingerprint,
          outcome: 'suppressed',
        }));
      }
    }
    return events;
  }
}

function agentRecommendationRecord(params: {
  id: string;
  workspace: Workspace;
  productId: string;
  eventId: string | null;
  source: string;
  fingerprint: string;
  outcome: AgentRecommendationRecord['outcome'];
}): AgentRecommendationRecord {
  return {
    id: params.id,
    workspaceId: params.workspace.id,
    productId: params.productId,
    eventId: params.eventId,
    agentId: listingSeoProfile.id,
    agentVersion: listingSeoProfile.version,
    creativityPreset: params.workspace.creativityPreset,
    sourceFingerprint: params.source,
    recommendationFingerprint: params.fingerprint,
    outcome: params.outcome,
    suggestedAt: new Date(),
  };
}
