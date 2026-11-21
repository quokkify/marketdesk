// Routes buyer-reply calls like AIProviderSelector: `offline` never contacts Hermes, `hermes`
// always uses it (failures reach the caller), `auto` uses Hermes only while it is configured,
// reachable and has no tools enabled. Each result names the provider that produced it.

import type { BuyerIntent } from '../../domain/conversations/types';
import type { IReplyDraftAI, ReplyContext } from '../../domain/ports/IReplyDraftAI';
import type { HermesProviderMode } from '../../../shared/types';
import type { HermesHealthProbe } from './HermesHealthProbe';

export interface ReplyDraftAISelectorDeps {
  hermes: IReplyDraftAI;
  offline: IReplyDraftAI;
  mode: HermesProviderMode;
  probe: Pick<HermesHealthProbe, 'isConfigured' | 'reachability'>;
}

export class ReplyDraftAISelector implements IReplyDraftAI {
  constructor(private readonly deps: ReplyDraftAISelectorDeps) {}

  async classify(ctx: ReplyContext) {
    return (await this.resolve()).classify(ctx);
  }

  async draft(ctx: ReplyContext, intent: BuyerIntent) {
    return (await this.resolve()).draft(ctx, intent);
  }

  private async resolve(): Promise<IReplyDraftAI> {
    const { mode, probe, hermes, offline } = this.deps;
    if (mode === 'hermes') return hermes;
    if (mode === 'auto' && probe.isConfigured()) {
      const check = await probe.reachability();
      if (check.reachable && check.toolsSafe) return hermes;
    }
    return offline;
  }
}
