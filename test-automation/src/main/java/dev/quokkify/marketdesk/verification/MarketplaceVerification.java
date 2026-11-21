package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.hamcrest.Matchers;

public class MarketplaceVerification extends BaseApiVerification<MarketplaceVerification> {

  @Override
  protected MarketplaceVerification self() {
    return this;
  }

  @Step("Response reports a failure")
  public MarketplaceVerification hasFailed(ValidatableResponse response) {
    response.body("success", Matchers.equalTo(false));
    return self();
  }

  @Step("Error code is {expected}")
  public MarketplaceVerification hasErrorCode(ValidatableResponse response, String expected) {
    response.body("error.code", Matchers.equalTo(expected));
    return self();
  }

  @Step("Error message is {expected}")
  public MarketplaceVerification hasErrorMessage(ValidatableResponse response, String expected) {
    response.body("error.message", Matchers.equalTo(expected));
    return self();
  }
}
