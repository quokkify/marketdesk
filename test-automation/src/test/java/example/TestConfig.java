package example;

import org.aeonbits.owner.Config;

@Config.LoadPolicy(Config.LoadType.MERGE)
@Config.Sources({"system:properties", "system:env", "classpath:test.properties"})
public interface TestConfig extends Config {

  @Key("TEST_MESSAGE")
  String message();
}
