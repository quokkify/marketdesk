// Researches the price anchor ladder of a product through PriceResearchGraph and records the
// attempt. From the first call attempt on, every outcome records the attempt, so a failing search
// is not retried until the ladder is stale again. Setup refusals (unknown product, search not
// configured, listing not in PLN) record nothing.

import type { PriceResearch } from '../../../shared/types';
import type { IPriceResearchRepository } from '../../domain/repositories/interfaces/IPriceResearchRepository';
import type { IPriceResearchRefresher, LadderOutcome } from '../../domain/ports/IPriceResearchRefresher';
import {
  BadGatewayError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../domain/shared/DomainError';
import { isResearchFresh } from '../../domain/services/researchFreshness';
import {
  SEARCH_NEEDS_PLN,
  SEARCH_NOT_CONFIGURED,
  SEARCH_UNUSABLE,
  type GraphResult,
  type PriceResearchGraph,
} from './PriceResearchGraph';

const RUN_BUDGET_MS = 7 * 60 * 1000;

// Structural, so the container can pass its logger.
export interface AnchorLadderLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

function isSetupRefusal(error: unknown): boolean {
  return error instanceof NotFoundError
    || (error instanceof ServiceUnavailableError && error.message === SEARCH_NOT_CONFIGURED)
    || (error instanceof ValidationError && error.message === SEARCH_NEEDS_PLN);
}

// A failed run keeps the errors of the single-call research: unavailability stays a 503,
// an answer without usable content a bad gateway.
function failureError(code: GraphResult['errorCode']): Error {
  switch (code) {
    case 'research_unreachable':
      return new ServiceUnavailableError('Market search is unavailable: the research profile is not reachable');
    case 'unsafe_toolset':
      return new ServiceUnavailableError('Market search is unavailable: the research profile must enable only the web toolset');
    case 'hermes_unavailable':
    case 'timeout':
      return new ServiceUnavailableError('Market search is unavailable: the research profile did not answer');
    default:
      return new BadGatewayError(SEARCH_UNUSABLE);
  }
}

export class AnchorLadderService implements IPriceResearchRefresher {
  constructor(
    private readonly priceResearchRepo: IPriceResearchRepository,
    private readonly graph: Pick<PriceResearchGraph, 'run'>,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: AnchorLadderLogger,
  ) {}

  async refreshIfStale(workspaceId: string, productId: string): Promise<LadderOutcome> {
    try {
      const stored = await this.priceResearchRepo.findByProduct(workspaceId, productId);
      if (isResearchFresh(stored?.lastAttemptAt ?? null, this.now())) return 'fresh';
      await this.refresh(workspaceId, productId);
      return 'refreshed';
    } catch (error) {
      if (error instanceof ServiceUnavailableError && error.message === SEARCH_NOT_CONFIGURED) return 'not_configured';
      if (error instanceof ValidationError && error.message === SEARCH_NEEDS_PLN) return 'not_pln';
      this.logger?.error({ productId, err: error }, 'Price anchor ladder refresh failed');
      return 'unavailable';
    }
  }

  // The graph checks the workspace first, so another workspace's product is a 404 whatever the setup.
  async refresh(workspaceId: string, productId: string): Promise<PriceResearch> {
    const attemptedAt = this.now().toISOString();
    let result: GraphResult;
    try {
      result = await this.graph.run({
        workspaceId,
        productId,
        signal: AbortSignal.timeout(RUN_BUDGET_MS),
        onNode: async () => undefined,
      });
    } catch (error) {
      if (!isSetupRefusal(error)) await this.recordAttempt(workspaceId, productId, attemptedAt);
      throw error;
    }
    await this.recordAttempt(workspaceId, productId, attemptedAt);
    if (result.outcome === 'failed') throw failureError(result.errorCode);
    const stored = await this.priceResearchRepo.findByProduct(workspaceId, productId);
    if (!stored) throw new NotFoundError(`Product not found: ${productId}`);
    return stored;
  }

  // The original failure matters more than a second one while recording the attempt.
  private async recordAttempt(workspaceId: string, productId: string, attemptedAt: string): Promise<void> {
    try {
      await this.priceResearchRepo.markAttempt(workspaceId, productId, attemptedAt);
    } catch (markError) {
      this.logger?.warn({ productId, err: markError }, 'Recording the research attempt failed');
    }
  }
}
