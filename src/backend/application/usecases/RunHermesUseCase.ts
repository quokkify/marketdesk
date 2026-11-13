// Use case: run the Hermes listing-seo analysis for one product. Loads the workspace
// context and delegates to HermesDecisionEngine.runProductSeo. The catalogue-wide
// HermesDecisionEngine.run is not reachable from here or from any route.

import { Result, Ok, Err } from '../../domain/shared/Result';
import {
  DomainError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../domain/shared/DomainError';
import { HermesDecisionEngine } from '../../domain/services/HermesDecisionEngine';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { RunHermesDTO } from '../dto/HermesDTO';

export class RunHermesUseCase {
  constructor(
    private readonly engine: HermesDecisionEngine,
    private readonly workspaceRepo: IWorkspaceRepository
  ) {}

  async execute(input: RunHermesDTO): Promise<Result<HermesEvent[]>> {
    const workspace = await this.workspaceRepo.findById(input.workspaceId);
    if (!workspace) {
      return Err(new NotFoundError(`Workspace not found: ${input.workspaceId}`));
    }

    try {
      const events = await this.engine.runProductSeo(workspace, input.productId);
      return Ok(events);
    } catch (error) {
      return Err(
        error instanceof DomainError
          ? error
          : new ServiceUnavailableError('Hermes run failed', error)
      );
    }
  }
}
