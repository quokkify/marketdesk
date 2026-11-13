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
}
