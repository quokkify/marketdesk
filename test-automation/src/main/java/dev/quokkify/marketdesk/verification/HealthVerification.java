package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.hamcrest.Matchers;

public class HealthVerification extends BaseApiVerification<HealthVerification> {

  @Override
  protected HealthVerification self() {
    return this;
  }

  @Step("Service status is {expected}")
  public HealthVerification hasStatus(ValidatableResponse response, String expected) {
    response.body("status", Matchers.equalTo(expected));
    return self();
  }

  @Step("Database is connected")
  public HealthVerification hasDatabaseConnected(ValidatableResponse response) {
    response.body("database", Matchers.equalTo("connected"));
    return self();
  }

  @Step("Redis is connected")
  public HealthVerification hasRedisConnected(ValidatableResponse response) {
    response.body("redis", Matchers.equalTo("connected"));
    return self();
  }
}
