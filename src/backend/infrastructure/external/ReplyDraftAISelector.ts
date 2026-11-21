// Routes buyer-reply calls like AIProviderSelector: `offline` never contacts Hermes, `hermes`
// always uses it and refuses when it is unreachable or has tools enabled, `auto` uses Hermes only
// while it is configured, reachable and tool-free. Each result names the provider that produced it.

import type { BuyerIntent } from '../../domain/conversations/types';
import type { IReplyDraftAI, ReplyContext } from '../../domain/ports/IReplyDraftAI';
import type { HermesProviderMode } from '../../../shared/types';
import { ServiceUnavailableError } from '../../domain/shared/DomainError';
import type { HermesHealthProbe } from './HermesHealthProbe';
import type { AiUsageSink } from '../../application/ai/AiCallRecord';
import { inAiUsageScope, recordAiCall, withAiOperation } from '../../application/ai/aiUsageScope';

export interface ReplyDraftAISelectorDeps {
  hermes: IReplyDraftAI;
  offline: IReplyDraftAI;
  mode: HermesProviderMode;
  probe: Pick<HermesHealthProbe, 'isConfigured' | 'reachability'>;
  usageSink?: AiUsageSink;
}

export class ReplyDraftAISelector implements IReplyDraftAI {
  constructor(private readonly deps: ReplyDraftAISelectorDeps) {}

  classify(ctx: ReplyContext) {
    return this.call('replyClassify', (provider) => provider.classify(ctx));
  }

  draft(ctx: ReplyContext, intent: BuyerIntent) {
    return this.call('replyDraft', (provider) => provider.draft(ctx, intent));
  }

  // Hermes calls are recorded by the completion client; an offline answer inside a usage scope
  // gets one record here. Records carry no buyer or draft text.
  private call<T>(operation: string, run: (provider: IReplyDraftAI) => Promise<T>): Promise<T> {
    return withAiOperation(operation, async () => {
      const provider = await this.resolve();
      if (provider !== this.deps.offline || !inAiUsageScope()) return run(provider);
      const startedAt = Date.now();
      const value = await run(provider);
      recordAiCall(this.deps.usageSink, {
        provider: 'offline',
        model: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - startedAt,
        outcome: 'ok',
        httpStatus: null,
        costStatus: 'not_applicable',
      });
      return value;
    });
  }

  private async resolve(): Promise<IReplyDraftAI> {
    const { mode, probe, hermes, offline } = this.deps;
    if (mode === 'offline') return offline;
    if (mode === 'hermes') {
      const check = probe.isConfigured() ? await probe.reachability() : null;
      if (!check || !check.reachable) {
        throw new ServiceUnavailableError('Hermes AI is not reachable in this environment');
      }
      if (!check.toolsSafe) {
        const detail = check.enabledToolsets.length
          ? `Enabled Hermes toolsets: ${check.enabledToolsets.join(', ')}`
          : 'Hermes did not return a readable toolset list';
        throw new ServiceUnavailableError(
          'Hermes AI is refused because its API server has tools enabled',
          new Error(detail),
        );
      }
      return hermes;
    }
    if (!probe.isConfigured()) return offline;
    const check = await probe.reachability();
    return check.reachable && check.toolsSafe ? hermes : offline;
  }
}
