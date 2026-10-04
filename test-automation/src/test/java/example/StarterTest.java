package example;

import dev.quokkify.config.ConfigRegistry;

import org.testng.annotations.Test;

import static org.testng.Assert.assertFalse;

public class StarterTest {

  @Test
  public void readsConfiguration() {
    TestConfig config = ConfigRegistry.get(TestConfig.class);
    assertFalse(config.message().isBlank());
  }
}
