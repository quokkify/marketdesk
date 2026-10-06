package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.hamcrest.Matchers;

public class ProductVerification extends BaseApiVerification<ProductVerification> {

  @Override
  protected ProductVerification self() {
    return this;
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
}
