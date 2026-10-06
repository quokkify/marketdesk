package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class HealthTest extends BaseTest {

  @Test
  public void reportsLiveness() {
    ValidatableResponse response = healthSteps.getHealth();
    healthSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasStatus(response, "ok");
  }

  @Test
  public void reportsDatabaseAndRedisReadiness() {
    ValidatableResponse response = healthSteps.getReadiness();
    healthSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasStatus(response, "ready")
        .hasDatabaseConnected(response)
        .hasRedisConnected(response);
  }
}
