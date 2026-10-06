package dev.quokkify.marketdesk.config;

import dev.quokkify.config.ConfigRegistry;

public final class MarketDeskApiConfig {

  private static final MarketDeskApiConfiguration CONFIG = ConfigRegistry.get(MarketDeskApiConfiguration.class);

  public static final String BASE_URI = CONFIG.baseUri();

  private MarketDeskApiConfig() {
  }
}
