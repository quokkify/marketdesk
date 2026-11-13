package dev.quokkify.marketdesk.config;

import dev.quokkify.config.ConfigRegistry;

public final class MarketDeskUiConfig {

  private static final MarketDeskUiConfiguration CONFIG = ConfigRegistry.get(MarketDeskUiConfiguration.class);

  public static final String BASE_URI = CONFIG.baseUri();

  private MarketDeskUiConfig() {
  }
}
