package dev.quokkify.marketdesk.config;

import org.aeonbits.owner.Config;

@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:marketdesk-ui.properties"})
interface MarketDeskUiConfiguration extends Config {

  @Key("MARKETDESK_UI_BASE_URI")
  String baseUri();
}
