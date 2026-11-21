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

  // Offline heuristics report no tokens: the sum stays null, never 0.
  @Step("Today counts {analyses} analysis, all of them offline, without tokens")
  public AiUsageVerification countsOfflineAnalysesToday(ValidatableResponse response, int analyses) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.today.analyses", Matchers.equalTo(analyses));
    response.body("data.today.offlineAnalyses", Matchers.equalTo(analyses));
    response.body("data.today.hermesAnalyses", Matchers.equalTo(0));
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
