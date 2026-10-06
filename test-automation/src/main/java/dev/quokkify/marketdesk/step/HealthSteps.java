package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.service.HealthService;
import dev.quokkify.marketdesk.verification.HealthVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;

public class HealthSteps extends ApiSteps<HealthVerification> {

  private final HealthService service = new HealthService();

  public HealthSteps() {
    this.verification = new HealthVerification();
  }

  @Step("Get liveness")
  public ValidatableResponse getHealth() {
    return service.getHealth();
  }

  @Step("Get readiness")
  public ValidatableResponse getReadiness() {
    return service.getReadiness();
  }
}
