package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class ProductVerification extends BaseApiVerification<ProductVerification> {

  private static final String OFFLINE_PROVIDER = "offline";
  private static final String COST_NOT_APPLICABLE = "not_applicable";

  @Override
  protected ProductVerification self() {
    return this;
  }

  @Step("Response reports success")
  public ProductVerification hasSucceeded(ValidatableResponse response) {
    response.body("success", Matchers.equalTo(true));
    return self();
  }

  @Step("Product list is empty")
  public ProductVerification hasNoProducts(ValidatableResponse response) {
    response.body("data", Matchers.empty());
    return self();
  }

  @Step("Response reports a failure")
  public ProductVerification hasFailed(ValidatableResponse response) {
    response.body("success", Matchers.equalTo(false));
    return self();
  }

  @Step("Error code is {expected}")
  public ProductVerification hasErrorCode(ValidatableResponse response, String expected) {
    response.body("error.code", Matchers.equalTo(expected));
    return self();
  }

  // Offline heuristics report no tokens: unknown stays null, never 0.
  @Step("Analysis reports offline AI usage without tokens")
  public ProductVerification reportsOfflineAiUsage(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.aiUsage.provider", Matchers.equalTo(OFFLINE_PROVIDER));
    response.body("data.aiUsage.totalTokens", Matchers.nullValue());
    response.body("data.aiUsage.costStatus", Matchers.equalTo(COST_NOT_APPLICABLE));
    return self();
  }
}
