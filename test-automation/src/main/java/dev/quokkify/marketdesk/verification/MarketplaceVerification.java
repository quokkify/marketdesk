package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class MarketplaceVerification extends BaseApiVerification<MarketplaceVerification> {

  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
  private static final String INVALID_STATE = "INVALID_STATE";
  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String SANDBOX_MESSAGE = "Marketplace import is not available in sandbox mode";

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

  @Step("Request is rejected as unauthenticated")
  public MarketplaceVerification isUnauthenticated(ValidatableResponse response) {
    return verifyResponseStatusCode(response, HttpStatus.SC_UNAUTHORIZED)
        .hasFailed(response)
        .hasErrorCode(response, UNAUTHORIZED);
  }

  @Step("Request is rejected by body validation")
  public MarketplaceVerification isValidationError(ValidatableResponse response) {
    return verifyResponseStatusCode(response, HttpStatus.SC_BAD_REQUEST)
        .hasFailed(response)
        .hasErrorCode(response, VALIDATION_ERROR);
  }

  @Step("Import is refused in sandbox mode")
  public MarketplaceVerification isSandboxRefusal(ValidatableResponse response) {
    return verifyResponseStatusCode(response, HttpStatus.SC_UNPROCESSABLE_ENTITY)
        .hasFailed(response)
        .hasErrorCode(response, INVALID_STATE)
        .hasErrorMessage(response, SANDBOX_MESSAGE);
  }

  @Step("Error message is {expected}")
  public MarketplaceVerification hasErrorMessage(ValidatableResponse response, String expected) {
    response.body("error.message", Matchers.equalTo(expected));
    return self();
  }
}
