package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class HermesMockVerification extends BaseApiVerification<HermesMockVerification> {

  @Override
  protected HermesMockVerification self() {
    return this;
  }

  @Step("The mock took the canned answer")
  public HermesMockVerification isAnswerRegistered(ValidatableResponse response) {
    return verifyResponseStatusCode(response, HttpStatus.SC_CREATED);
  }

  // MockServer answers 202 when the count matches and 406, with the requests it received, when it does not.
  @Step("The mock received the expected number of calls")
  public HermesMockVerification receivedExpectedCalls(ValidatableResponse response) {
    return verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
  }
}
