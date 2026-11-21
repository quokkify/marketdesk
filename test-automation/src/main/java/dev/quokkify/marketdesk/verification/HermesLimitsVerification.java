package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class HermesLimitsVerification extends BaseApiVerification<HermesLimitsVerification> {

  @Override
  protected HermesLimitsVerification self() {
    return this;
  }

  @Step("Limits are fresh: plan Plus, Session 4.0 and Weekly 10.0, account-wide, no reset hint")
  public HermesLimitsVerification areFreshWithPlanAndWindows(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.reason", Matchers.nullValue());
    response.body("data.state", Matchers.equalTo("fresh"));
    response.body("data.scope", Matchers.equalTo("account"));
    response.body("data.plan", Matchers.equalTo("Plus"));
    response.body("data.windows.label", Matchers.contains("Session", "Weekly"));
    response.body("data.windows.usedPercent", Matchers.contains(4, 10));
    response.body("data.details", Matchers.contains("Credits: 12"));
    return self();
  }

  @Step("Limits are stale but keep their values")
  public HermesLimitsVerification areStaleWithValues(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.state", Matchers.equalTo("stale"));
    response.body("data.plan", Matchers.equalTo("Plus"));
    response.body("data.windows", Matchers.hasSize(2));
    response.body("data.ageSeconds", Matchers.greaterThan(15 * 60));
    return self();
  }

  @Step("Limits are unknown, without any numbers")
  public HermesLimitsVerification areUnknown(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.state", Matchers.equalTo("unknown"));
    response.body("data.windows", Matchers.empty());
    response.body("data.reason", Matchers.notNullValue());
    return self();
  }

  @Step("Limits are unknown because of: {reason}")
  public HermesLimitsVerification areUnknownBecause(ValidatableResponse response, String reason) {
    areUnknown(response);
    response.body("data.reason", Matchers.equalTo(reason));
    return self();
  }

  @Step("Request is rejected as unauthenticated")
  public HermesLimitsVerification isUnauthenticated(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_UNAUTHORIZED);
    return self();
  }
}
