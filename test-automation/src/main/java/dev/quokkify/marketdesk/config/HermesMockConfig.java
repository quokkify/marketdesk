package dev.quokkify.marketdesk.config;

import dev.quokkify.config.ConfigRegistry;

// The MockServer that stands in for the Hermes research profile in the test stack; tests reach its control API.
public final class HermesMockConfig {

  private static final HermesMockConfiguration CONFIG = ConfigRegistry.get(HermesMockConfiguration.class);

  public static final String BASE_URI = CONFIG.baseUri();

  private HermesMockConfig() {
  }
}
