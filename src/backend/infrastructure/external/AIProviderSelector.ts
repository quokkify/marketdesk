// Routes each AI call to the Hermes adapter or to the built-in offline heuristics.
// HERMES_PROVIDER_MODE decides: `offline` never contacts Hermes, `hermes` always uses
// it and lets its failures reach the caller, and `auto` uses Hermes only while it is
// configured and its health probe answers. Hermes is used only while its API server
// reports no enabled toolsets: `auto` falls back to offline when tools are on, `hermes`
// refuses the call. The choice is made per call, so auto mode follows Hermes going
// down or coming back without a restart.

import type {
  AIProviderSourceAware,
  IAIProvider,
  ListingAnalysis,
  PriceSuggestion,
  PriceSuggestionContext,
} from '../../domain/ports/IAIProvider';
import type { Product } from '../../domain/entities/Product';
import type { Marketplace } from '../../domain/entities/Marketplace';
import type {
  CreativityPreset,
  ListingSeoInput,
  ListingSeoOutput,
} from '../../domain/agents/MarketDeskAgentCatalog';
import type { HermesProviderMode, HermesStatusView } from '../../../shared/types';
import { ServiceUnavailableError } from '../../domain/shared/DomainError';
import type { HermesHealthProbe } from './HermesHealthProbe';
import type { AiUsageSink } from '../../application/ai/AiCallRecord';
import { inAiUsageScope, recordAiCall, withAiOperation } from '../../application/ai/aiUsageScope';

export interface AIProviderSelectorDeps {
  hermes: IAIProvider;
  offline: IAIProvider;
  mode: HermesProviderMode;
  probe: Pick<HermesHealthProbe, 'isConfigured' | 'reachability'>;
  usageSink?: AiUsageSink;
}

export class AIProviderSelector implements IAIProvider, AIProviderSourceAware {
  constructor(private readonly deps: AIProviderSelectorDeps) {}

  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    return this.call('suggestPrice', (provider) => provider.suggestPrice(context));
  }

  async generateTitle(
    product: Product,
    marketplace: Marketplace | null,
    creativityPreset?: CreativityPreset
  ): Promise<string> {
    return this.call('generateTitle', (provider) =>
      provider.generateTitle(product, marketplace, creativityPreset));
  }

  async analyzeListing(product: Product): Promise<ListingAnalysis> {
    return this.call('analyzeListing', (provider) => provider.analyzeListing(product));
  }

  async analyzeListingSeo(
    input: ListingSeoInput,
    preset: CreativityPreset
  ): Promise<ListingSeoOutput> {
    return this.call('analyzeListingSeo', (provider) => provider.analyzeListingSeo(input, preset));
  }

  // The routing decision behind every AI call, status() and the decision engine's
  // review-only rule for offline results. In hermes mode resolve() additionally
  // refuses the call when Hermes is unreachable or has tools enabled.
  async activeProvider(): Promise<'hermes' | 'offline'> {
    const { mode, probe } = this.deps;
    if (mode !== 'auto') return mode;
    if (!probe.isConfigured()) return 'offline';
    const check = await probe.reachability();
    return check.reachable && check.toolsSafe ? 'hermes' : 'offline';
  }

  async status(): Promise<HermesStatusView> {
    const { mode, probe } = this.deps;
    const hermesConfigured = probe.isConfigured();
    const check = mode !== 'offline' && hermesConfigured ? await probe.reachability() : null;
    const activeProvider =
      mode === 'auto' ? (check?.reachable && check.toolsSafe ? 'hermes' : 'offline') : mode;
    return {
      mode,
      activeProvider,
      hermesConfigured,
      hermesReachable: check ? check.reachable : null,
      hermesToolsSafe: check ? check.toolsSafe : null,
      hermesEnabledToolsets: check ? check.enabledToolsets : [],
      // When the probe asked Hermes; without a probe check, when this status was made.
      checkedAt: (check?.checkedAt ?? new Date()).toISOString(),
    };
  }

  // Hermes calls are recorded by the completion client. An offline answer inside a usage scope
  // gets one record here, so the analysis reports that it ran on the heuristics.
  private call<T>(operation: string, run: (provider: IAIProvider) => Promise<T>): Promise<T> {
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

  private async resolve(): Promise<IAIProvider> {
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
    return (await this.activeProvider()) === 'hermes' ? hermes : offline;
  }
}
