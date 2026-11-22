// The price check of the sale verdict. guard: a PLN listing, and research configured or already
// stored. research (when forced or due by the automatic schedule): one price research run inline,
// recorded in price_research_runs like the research job's runs, within the verdict run's budget.
// estimate: the price estimate and its event (one estimate per check). rule: the fair-price rule.
// A failed research run still estimates from stored research when there is some (the check then
// adds research_failed); with none the check fails. A research run already active for the product
// is not waited for: the check stays pending.
// State holds no seller or Hermes text: the estimate's reasoning and note are dropped before it.

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { StoredPriceEstimate, VerdictCheck } from '../../../../shared/types';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import type { IPriceResearchRuns } from '../../../domain/ports/IPriceResearchRuns';
import { researchDue } from '../../../domain/services/researchSchedule';
import { checkFailed, priceCheckFromEstimate, type PriceCheckInput } from '../../../domain/services/saleVerdictRules';
import { SEARCH_CURRENCY } from '../PriceResearchGraph';
import type { RecordedResearchRun } from '../recordedResearchRun';
import type { PriceProposals } from './PriceProposals';
import type { CheckContext, CheckGraph } from './SaleVerdictGraph';

const RESEARCH_FAILED = { code: 'research_failed', message: 'Market research failed, the price was judged on saved research' };

const PriceState = Annotation.Root({
  hasResearch: Annotation<boolean>(),
  runResearch: Annotation<boolean>(),
  researchFailed: Annotation<boolean>(),
  // Set once the rule has its input: by a guard, by the research node or by the estimate.
  input: Annotation<PriceCheckInput | null>(),
  check: Annotation<VerdictCheck | null>(),
});

type PriceGraphState = typeof PriceState.State;

export interface PriceCheckDeps {
  proposals: Pick<PriceProposals, 'proposeForVerdict'>;
  research: Pick<IPriceResearchRepository, 'findByProduct'>;
  // Its latest() also writes a stuck active run as failed, which frees the product.
  runs: Pick<IPriceResearchRuns, 'latest'>;
  recorded: Pick<RecordedResearchRun, 'start'>;
  // Whether a research profile is configured.
  configured: boolean;
  newId: () => string;
}

function withoutText(stored: StoredPriceEstimate | null): StoredPriceEstimate | null {
  return stored && { ...stored, researchNote: null, estimate: { ...stored.estimate, reasoning: '' } };
}

function usableEstimate(input: PriceCheckInput | null): boolean {
  return (
    input?.kind === 'estimated' && input.stored !== null && input.suggestionType !== 'price_estimate_unavailable'
  );
}

export function buildPriceCheck(deps: PriceCheckDeps): CheckGraph {
  return async (ctx: CheckContext) => {
    const { workspace, product, listing } = ctx;

    const guard = async (): Promise<Partial<PriceGraphState>> => {
      if (!listing) return { input: { kind: 'no_listing' } };
      if (listing.price.currency !== SEARCH_CURRENCY) return { input: { kind: 'not_pln' } };
      const research = await deps.research.findByProduct(workspace.id, product.id);
      const hasResearch = (research?.comparables.length ?? 0) > 0;
      if (!deps.configured) return hasResearch ? { hasResearch } : { input: { kind: 'not_configured' } };
      const { active, last } = await deps.runs.latest(workspace.id, product.id);
      const due = ctx.options.forceResearch || researchDue(last, research?.lastAttemptAt, ctx.now());
      if (due && active) return { input: { kind: 'research_running' } };
      return { hasResearch, runResearch: due };
    };

    const research = async (state: PriceGraphState): Promise<Partial<PriceGraphState>> => {
      const recorded = await deps.recorded.start(
        {
          id: deps.newId(),
          workspaceId: workspace.id,
          productId: product.id,
          trigger: ctx.options.forceResearch ? 'manual' : 'analyze',
        },
        ctx.signal,
      );
      // Another run holds the product (a research job, or one queued just before this).
      if (recorded.kind !== 'finished') return { input: { kind: 'research_running' } };
      if (recorded.outcome !== 'failed') return { hasResearch: true };
      const hasResearch = state.hasResearch || (recorded.result?.research?.comparables.length ?? 0) > 0;
      return hasResearch ? { researchFailed: true } : { researchFailed: true, input: { kind: 'failed' } };
    };

    const estimate = async (): Promise<Partial<PriceGraphState>> => {
      if (!listing) return { input: { kind: 'no_listing' } };
      const proposal = await deps.proposals.proposeForVerdict(product, listing);
      if (proposal.skipped === 'research_pending') return { input: { kind: 'research_running' } };
      return {
        input: {
          kind: 'estimated',
          currentPrice: product.sellingPrice.amount,
          stored: withoutText(proposal.stored),
          suggestionType: proposal.suggestionType,
          eventIds: proposal.eventIds,
        },
      };
    };

    const rule = (state: PriceGraphState): Partial<PriceGraphState> => {
      const now = ctx.now();
      if (!state.input) return { check: checkFailed('price', now) };
      if (!state.researchFailed) return { check: priceCheckFromEstimate(state.input, now) };
      if (!usableEstimate(state.input)) return { check: checkFailed('price', now) };
      const check = priceCheckFromEstimate(state.input, now);
      return { check: { ...check, reasons: [...check.reasons, { ...RESEARCH_FAILED }] } };
    };

    const graph = new StateGraph(PriceState)
      .addNode('guard', guard)
      .addNode('research', research)
      .addNode('estimate', estimate)
      .addNode('rule', rule)
      .addEdge(START, 'guard')
      .addConditionalEdges(
        'guard',
        (state: PriceGraphState) => (state.input ? 'rule' : state.runResearch ? 'research' : 'estimate'),
        ['research', 'estimate', 'rule'],
      )
      .addConditionalEdges('research', (state: PriceGraphState) => (state.input ? 'rule' : 'estimate'), [
        'estimate',
        'rule',
      ])
      .addEdge('estimate', 'rule')
      .addEdge('rule', END)
      .compile();
    const { check } = await graph.invoke({
      hasResearch: false,
      runResearch: false,
      researchFailed: false,
      input: null,
      check: null,
    });
    if (!check) throw new Error('The price check produced no result');
    return check;
  };
}
