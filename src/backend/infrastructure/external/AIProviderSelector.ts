// Routes each AI call to the Hermes adapter or to the built-in offline heuristics.
// HERMES_PROVIDER_MODE decides: `offline` never contacts Hermes, `hermes` always uses
// it and lets its failures reach the caller, and `auto` uses Hermes only while it is
// configured and its health probe answers. The choice is made per call, so auto mode
// follows Hermes going down or coming back without a restart.

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
import type { HermesHealthProbe } from './HermesHealthProbe';

export interface AIProviderSelectorDeps {
  hermes: IAIProvider;
  offline: IAIProvider;
  mode: HermesProviderMode;
  probe: Pick<HermesHealthProbe, 'isConfigured' | 'isReachable'>;
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
    return probe.isConfigured() && (await probe.isReachable()) ? 'hermes' : 'offline';
  }

  async status(): Promise<HermesStatusView> {
    const { mode, probe } = this.deps;
    const activeProvider = await this.activeProvider();
    const hermesConfigured = probe.isConfigured();
    const hermesReachable =
      mode !== 'offline' && hermesConfigured ? await probe.isReachable() : null;
    return {
      mode,
      activeProvider,
      hermesConfigured,
      hermesReachable,
      checkedAt: new Date().toISOString(),
    };
  }

  private async resolve(): Promise<IAIProvider> {
    return (await this.activeProvider()) === 'hermes' ? this.deps.hermes : this.deps.offline;
  }
}
