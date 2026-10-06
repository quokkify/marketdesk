package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

public class HealthTest extends BaseTest {

  @Test(groups = "api")
  public void reportsLiveness() {
    ValidatableResponse response = healthSteps.getHealth();
    healthSteps.verify()
        .verifyResponseStatusCode(response, 200)
        .hasStatus(response, "ok");
  }

  @Test(groups = "api")
  public void reportsDatabaseAndRedisReadiness() {
    ValidatableResponse response = healthSteps.getReadiness();
    healthSteps.verify()
        .verifyResponseStatusCode(response, 200)
        .hasStatus(response, "ready")
        .hasDatabaseConnected(response)
        .hasRedisConnected(response);
  }
}
