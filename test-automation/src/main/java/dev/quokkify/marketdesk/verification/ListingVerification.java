package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class ListingVerification extends BaseApiVerification<ListingVerification> {

  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String INVALID_STATE = "INVALID_STATE";
  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
  private static final String GUARDRAIL_VIOLATION = "GUARDRAIL_VIOLATION";
  private static final String CATEGORY_MESSAGE = "Select an exact OLX leaf category before publishing";
  private static final String CONDITION_MESSAGE = "Choose the product's condition before publishing to OLX";
  private static final String REVIVAL_MESSAGE = "Only an expired listing with an OLX advert can be revived";
  private static final String COST_PRICE_NOTE = "Without a cost price the price floor cannot be checked";
  private static final String SANDBOX_MESSAGE = "Reactivation is not available in sandbox mode";

  @Override
  protected ListingVerification self() {
    return this;
  }

  @Step("Request is rejected as unauthenticated")
  public ListingVerification isUnauthenticated(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_UNAUTHORIZED, UNAUTHORIZED);
  }

  @Step("Listing is not found")
  public ListingVerification isNotFound(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_NOT_FOUND, NOT_FOUND);
  }

  @Step("Reactivation is refused in sandbox mode")
  public ListingVerification isSandboxRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, INVALID_STATE);
    response.body("error.message", Matchers.equalTo(SANDBOX_MESSAGE));
    return self();
  }

  @Step("Publishing is refused until the product's condition is chosen")
  public ListingVerification isConditionRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_BAD_REQUEST, VALIDATION_ERROR);
    response.body("error.message", Matchers.equalTo(CONDITION_MESSAGE));
    return self();
  }

  @Step("Publishing passes the condition rule and stops at the category guard")
  public ListingVerification isCategoryGuardRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, GUARDRAIL_VIOLATION);
    response.body("error.message", Matchers.equalTo(CATEGORY_MESSAGE));
    return self();
  }

  // The stack runs on the offline heuristics, which Hermes never reviewed, so there is no AI proposal to check.
  @Step("Revival proposal asks for the condition and the cost price and proposes nothing from offline AI")
  public ListingVerification isProposalWithMissingConditionAndCostPrice(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("success", Matchers.equalTo(true));
    response.body("data.missingFacts.find { it.field == 'condition' }.required", Matchers.equalTo(true));
    response.body("data.missingFacts.find { it.field == 'costPrice' }.required", Matchers.equalTo(false));
    response.body("data.missingFacts.find { it.field == 'costPrice' }.note", Matchers.equalTo(COST_PRICE_NOTE));
    response.body("data.priceGuard.status", Matchers.oneOf("unchecked", "no_proposal"));
    response.body("data.priceGuard.costPrice", Matchers.nullValue());
    response.body("data.aiUsage.provider", Matchers.equalTo("offline"));
    response.body("data.aiIssues", Matchers.empty());
    response.body("data.productUpdatedAt", Matchers.notNullValue());
    response.body("data.listingUpdatedAt", Matchers.notNullValue());
    return self();
  }

  @Step("Revival is refused for a listing that has not expired on OLX")
  public ListingVerification isRevivalRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, INVALID_STATE);
    response.body("error.message", Matchers.equalTo(REVIVAL_MESSAGE));
    return self();
  }

  private ListingVerification failsWith(ValidatableResponse response, int status, String code) {
    verifyResponseStatusCode(response, status);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }
}
