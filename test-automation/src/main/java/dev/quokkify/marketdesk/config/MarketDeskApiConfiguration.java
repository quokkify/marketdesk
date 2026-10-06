package dev.quokkify.marketdesk.config;

import org.aeonbits.owner.Config;

@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:marketdesk-api.properties"})
interface MarketDeskApiConfiguration extends Config {

  @Key("MARKETDESK_API_BASE_URI")
  String baseUri();
}
