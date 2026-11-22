package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class AiUsageVerification extends BaseApiVerification<AiUsageVerification> {

  @Override
  protected AiUsageVerification self() {
    return this;
  }

  // Offline heuristics and refused Hermes calls report no tokens: the sum stays null, never 0.
  @Step("Today counts {offline} offline and {hermes} Hermes analyses, without tokens")
  public AiUsageVerification countsAnalysesToday(ValidatableResponse response, int offline, int hermes) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.today.analyses", Matchers.equalTo(offline + hermes));
    response.body("data.today.offlineAnalyses", Matchers.equalTo(offline));
    response.body("data.today.hermesAnalyses", Matchers.equalTo(hermes));
    response.body("data.today.totalTokens", Matchers.nullValue());
    return self();
  }

  @Step("Today counts no analyses")
  public AiUsageVerification countsNoAnalysesToday(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.today.analyses", Matchers.equalTo(0));
    return self();
  }

  @Step("Request is rejected as unauthenticated")
  public AiUsageVerification isUnauthenticated(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_UNAUTHORIZED);
    return self();
  }
}
