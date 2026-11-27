// The attributes check of the sale verdict. load: the run's OLX snapshot. categoryGate: a category
// mismatch stops the check before any write. match: empty single-choice attributes whose one
// allowed value appears as a whole word in the product's name or description. write (only with such
// values): one advert update, guarded by an idempotency key on the listing and the values, recorded
// as an applied auto_apply event. reread: what OLX kept after the write. hermes (only with a client
// and still-empty attributes): Hermes picks values from OLX's lists, saved as one pending proposal
// that supersedes the product's earlier one. result: the check.
// State holds only OLX attribute and value codes and event ids, never seller or Hermes text.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AdvertAttributesChangePayload, HermesEventType, VerdictCheck } from '../../../../shared/types';
import { HermesEvent } from '../../../domain/entities/HermesEvent';
import type { IEventRepository } from '../../../domain/repositories/interfaces/IEventRepository';
import {
  attributeDroppedReason,
  attributeIdempotencyKey,
  attributesCheck,
  categoryFirstCheck,
  containsWholeWord,
  fillableAttributes,
  verifiableValues,
  type AdvertAttribute,
  type OlxCategoryAttribute,
} from '../../../domain/services/advertCompletenessRules';
import type { IdFactory } from '../../../domain/services/proposalSupport';
import type { AITextCompletionClient } from '../../../infrastructure/external/HermesAI';
import { buildAttributeChoicePrompt, parseAttributeChoices } from '../../../infrastructure/external/advertFieldPrompts';
import { researchItemFromProduct } from '../../../infrastructure/external/priceResearchPrompts';
import { withAiOperation } from '../../ai/aiUsageScope';
import type { AdvertFieldsService } from '../AdvertFieldsService';
import { requireOlxSnapshot, type OlxAdvertSnapshot } from './olxAdvertSnapshot';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const PROPOSAL_TYPE: HermesEventType = 'suggested_advert_attributes';
// hermes_events.title is VARCHAR(255).
const EVENT_TITLE_MAX_LENGTH = 255;

function eventTitle(text: string): string {
  return text.length <= EVENT_TITLE_MAX_LENGTH ? text : `${text.slice(0, EVENT_TITLE_MAX_LENGTH - 1)}…`;
}

const AttributesState = Annotation.Root({
  verifiable: Annotation<AdvertAttribute[]>(),
  kept: Annotation<AdvertAttribute[]>(),
  dropped: Annotation<AdvertAttribute[]>(),
  proposalSaved: Annotation<boolean>(),
  eventIds: Annotation<string[]>({ reducer: (current, update) => [...current, ...update], default: () => [] }),
  check: Annotation<VerdictCheck | null>(),
});

type AttributesGraphState = typeof AttributesState.State;

export interface AttributesCheckDeps {
  fields: Pick<AdvertFieldsService, 'apply'>;
  events: IEventRepository;
  hermes: AITextCompletionClient | null;
  idFactory: IdFactory;
  logger?: { warn(context: Record<string, unknown>, message: string): void };
}

// Values with the OLX labels the owner reads; every value is one of the category's own.
function labelled(category: OlxCategoryAttribute[], values: AdvertAttribute[]): AdvertAttributesChangePayload['values'] {
  return values.flatMap((value) => {
    const attribute = category.find((candidate) => candidate.code === value.code);
    const allowed = attribute?.values.find((candidate) => candidate.code === value.value);
    return attribute && allowed
      ? [{ code: value.code, value: value.value, label: attribute.label, valueLabel: allowed.label }]
      : [];
  });
}

export function buildAttributesCheck(deps: AttributesCheckDeps): CheckGraph {
  return async (ctx: CheckContext) => {
    const { workspace, product } = ctx;
    let snapshot: OlxAdvertSnapshot;
    // The advert's attributes after the write; a free-text value may be seller text, so not in state.
    let current: AdvertAttribute[] = [];

    const listingId = (): string => {
      if (!ctx.listing) throw new Error('The attributes check needs a listing');
      return ctx.listing.id;
    };

    const write = async (state: AttributesGraphState): Promise<Partial<AttributesGraphState>> => {
      const values = labelled(snapshot.categoryAttributes, state.verifiable);
      const where = (valueLabel: string) =>
        containsWholeWord(product.name, valueLabel) ? 'found in the title' : 'found in the description';
      const created = HermesEvent.create({
        id: deps.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type: 'filled_advert_attributes',
        severity: 'info',
        title: eventTitle(
          `Filled ${values.map((value) => `${value.label}: ${value.valueLabel} (${where(value.valueLabel)})`).join(', ')}`,
        ),
        proposedChange: { kind: 'attributes', listingId: listingId(), values },
        status: 'applying',
        autonomyDecision: 'auto_apply',
        source: null,
      });
      if (created.isErr()) throw created.error;
      const event = created.value;
      // The key makes the write once per listing and values, however often the run repeats.
      if (!(await deps.events.saveRecommendationIfAbsent(event, attributeIdempotencyKey(listingId(), state.verifiable)))) {
        return {};
      }
      try {
        const { kept, dropped } = await deps.fields.apply(workspace.id, listingId(), { attributes: state.verifiable });
        event.markApplied(ctx.now());
        await deps.events.save(event);
        return { kept, dropped, eventIds: [event.id] };
      } catch (error) {
        event.markFailed(ctx.now());
        await deps.events.save(event);
        throw error;
      }
    };

    const reread = (state: AttributesGraphState): Partial<AttributesGraphState> => {
      current = [...snapshot.attributes, ...state.kept];
      return {};
    };

    // Attributes Hermes may still fill: empty after the write, and not one OLX just refused.
    const stillEmpty = (state: AttributesGraphState): OlxCategoryAttribute[] =>
      fillableAttributes(snapshot.categoryAttributes, current).filter(
        (attribute) => !state.dropped.some((dropped) => dropped.code === attribute.code),
      );

    const hermes = async (state: AttributesGraphState): Promise<Partial<AttributesGraphState>> => {
      const client = deps.hermes;
      if (!client || !ctx.listing) return {};
      const offered = stillEmpty(state);
      let picks: AdvertAttribute[];
      try {
        const { system, prompt } = buildAttributeChoicePrompt(researchItemFromProduct(product, ctx.listing), offered);
        const raw = await withAiOperation('verdict.attributes', () => client.complete({ system, prompt, signal: ctx.signal }));
        picks = parseAttributeChoices(raw, offered);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        deps.logger?.warn(
          { productId: product.id, errorName: error instanceof Error ? error.name : 'unknown' },
          'Hermes attribute choice failed in the attributes check',
        );
        return {};
      }
      const values = labelled(snapshot.categoryAttributes, picks);
      if (values.length === 0) return {};
      const created = HermesEvent.create({
        id: deps.idFactory(),
        workspaceId: workspace.id,
        productId: product.id,
        type: PROPOSAL_TYPE,
        severity: 'info',
        title: eventTitle(`Fill OLX fields: ${values.map((value) => `${value.label}: ${value.valueLabel}`).join(', ')}`),
        proposedChange: { kind: 'attributes', listingId: ctx.listing.id, values },
        status: 'pending_review',
        autonomyDecision: 'pending_review',
        source: 'hermes',
      });
      if (created.isErr()) throw created.error;
      await deps.events.dismissPendingByProduct(workspace.id, product.id, [PROPOSAL_TYPE], ctx.now());
      await deps.events.save(created.value);
      return { proposalSaved: true, eventIds: [created.value.id] };
    };

    const result = async (state: AttributesGraphState): Promise<Partial<AttributesGraphState>> => {
      const pending = state.proposalSaved
        ? []
        : await deps.events.findPendingByProduct(workspace.id, product.id, [PROPOSAL_TYPE]);
      const check = attributesCheck({
        category: snapshot.categoryAttributes,
        current,
        proposalOpen: state.proposalSaved || pending.length > 0,
        now: ctx.now(),
        eventIds: [...state.eventIds, ...pending.map((event) => event.id)],
      });
      const droppedReasons = labelled(snapshot.categoryAttributes, state.dropped).map((value) =>
        attributeDroppedReason(value.label),
      );
      return { check: { ...check, reasons: [...check.reasons, ...droppedReasons] } };
    };

    const graph = new StateGraph(AttributesState)
      .addNode('load', async () => {
        snapshot = await requireOlxSnapshot(ctx);
        return {};
      })
      .addNode('categoryGate', () =>
        snapshot.categoryMismatch ? { check: categoryFirstCheck('attributes', ctx.now()) } : {},
      )
      .addNode('match', () => ({
        verifiable: verifiableValues(fillableAttributes(snapshot.categoryAttributes, snapshot.attributes), {
          name: product.name,
          description: product.description,
        }),
      }))
      .addNode('write', write)
      .addNode('reread', reread)
      .addNode('hermes', hermes)
      .addNode('result', result)
      .addEdge(START, 'load')
      .addEdge('load', 'categoryGate')
      .addConditionalEdges('categoryGate', (state: AttributesGraphState) => (state.check ? END : 'match'), [
        'match',
        END,
      ])
      .addConditionalEdges('match', (state: AttributesGraphState) => (state.verifiable.length > 0 ? 'write' : 'reread'), [
        'write',
        'reread',
      ])
      .addEdge('write', 'reread')
      .addConditionalEdges(
        'reread',
        (state: AttributesGraphState) => (deps.hermes && stillEmpty(state).length > 0 ? 'hermes' : 'result'),
        ['hermes', 'result'],
      )
      .addEdge('hermes', 'result')
      .addEdge('result', END)
      .compile();
    const { check } = await graph.invoke({
      verifiable: [],
      kept: [],
      dropped: [],
      proposalSaved: false,
      eventIds: [],
      check: null,
    });
    if (!check) throw new Error('The attributes check produced no result');
    return check;
  };
}
