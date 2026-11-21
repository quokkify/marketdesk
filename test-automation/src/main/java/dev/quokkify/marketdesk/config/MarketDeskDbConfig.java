package dev.quokkify.marketdesk.config;

import dev.quokkify.config.ConfigRegistry;

public final class MarketDeskDbConfig {

  private static final MarketDeskDbConfiguration CONFIG = ConfigRegistry.get(MarketDeskDbConfiguration.class);

  public static final String URL = CONFIG.url();
  public static final String USER = CONFIG.user();
  public static final String PASSWORD = CONFIG.password();

  private MarketDeskDbConfig() {
  }
}
