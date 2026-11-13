// Factory that resolves a marketplace key to a concrete adapter implementing the
// domain IMarketplaceAdapter port. Keeps the application/domain layers agnostic
// to which concrete adapter backs a given marketplace. Only OLX is operational;
// every other key fails closed with MarketplaceNotImplementedError.

import type { IMarketplaceAdapter } from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey } from '../../../shared/types';
import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import type { MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import { MarketplaceNotImplementedError } from './MarketplaceError';
import { OLXAdapter, type OlxAdapterConfig } from './OLXAdapter';

type AdapterFactory = (
  http?: MarketplaceHttpClient,
  options?: MarketplaceAdapterOptions,
) => IMarketplaceAdapter;

export interface MarketplaceAdapterFactoryConfig {
  httpClients?: Partial<Record<MarketplaceKey, MarketplaceHttpClient>>;
  options?: Partial<Record<MarketplaceKey, MarketplaceAdapterOptions>>;
  olx?: OlxAdapterConfig;
}

export class MarketplaceAdapterFactory {
  private readonly registry = new Map<MarketplaceKey, AdapterFactory>();

  constructor(private readonly config: MarketplaceAdapterFactoryConfig = {}) {
    this.registry.set(
      'olx',
      (http, options) => new OLXAdapter(http, options, this.config.olx),
    );
  }

  isSupported(key: MarketplaceKey): boolean {
    return this.registry.has(key);
  }

  // Create an adapter for the given marketplace key. An optional HTTP client can
  // be injected (e.g. a real transport in production, a mock in tests); when
  // omitted the adapter falls back to its deterministic stub transport.
  create(
    key: MarketplaceKey,
    http?: MarketplaceHttpClient,
    options?: MarketplaceAdapterOptions,
  ): IMarketplaceAdapter {
    const factory = this.registry.get(key);
    if (!factory) {
      throw new MarketplaceNotImplementedError(
        `No marketplace adapter registered for key: ${key}`,
      );
    }
    return factory(
      http ?? this.config.httpClients?.[key],
      options ?? this.config.options?.[key],
    );
  }
}
