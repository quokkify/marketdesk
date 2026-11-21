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

export interface AIProviderSelectorDeps {
  hermes: IAIProvider;
  offline: IAIProvider;
  mode: HermesProviderMode;
  probe: Pick<HermesHealthProbe, 'isConfigured' | 'reachability'>;
}

export class AIProviderSelector implements IAIProvider, AIProviderSourceAware {
  constructor(private readonly deps: AIProviderSelectorDeps) {}

  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    return (await this.resolve()).suggestPrice(context);
  }

  async generateTitle(
    product: Product,
    marketplace: Marketplace | null,
    creativityPreset?: CreativityPreset
  ): Promise<string> {
    return (await this.resolve()).generateTitle(product, marketplace, creativityPreset);
  }

  async analyzeListing(product: Product): Promise<ListingAnalysis> {
    return (await this.resolve()).analyzeListing(product);
  }

  async analyzeListingSeo(
    input: ListingSeoInput,
    preset: CreativityPreset
  ): Promise<ListingSeoOutput> {
    return (await this.resolve()).analyzeListingSeo(input, preset);
  }

  // The single routing decision behind every AI call, status() and the decision
  // engine's review-only rule for offline results.
  async activeProvider(): Promise<'hermes' | 'offline'> {
    const { mode, probe } = this.deps;
    if (mode !== 'auto') return mode;
    if (!probe.isConfigured()) return 'offline';
    const check = await probe.reachability();
    return check.reachable && check.toolsSafe ? 'hermes' : 'offline';
  }

  async status(): Promise<HermesStatusView> {
    const { mode, probe } = this.deps;
    const activeProvider = await this.activeProvider();
    const hermesConfigured = probe.isConfigured();
    const check = mode !== 'offline' && hermesConfigured ? await probe.reachability() : null;
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
