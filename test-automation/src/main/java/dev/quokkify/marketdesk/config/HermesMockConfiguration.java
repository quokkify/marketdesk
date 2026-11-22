package dev.quokkify.marketdesk.config;

import org.aeonbits.owner.Config;

@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:marketdesk-hermes-mock.properties"})
interface HermesMockConfiguration extends Config {

  @Key("MARKETDESK_HERMES_MOCK_BASE_URI")
  String baseUri();
}
