package dev.quokkify.marketdesk.config;

import org.aeonbits.owner.Config;

@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:marketdesk-db.properties"})
interface MarketDeskDbConfiguration extends Config {

  @Key("MARKETDESK_DB_URL")
  String url();

  @Key("MARKETDESK_DB_USER")
  String user();

  @Key("MARKETDESK_DB_PASSWORD")
  String password();
}
