package dev.quokkify.marketdesk.verification;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class ListingVerification extends BaseApiVerification<ListingVerification> {

  private static final double PRICE_TOLERANCE = 0.001;
  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String INVALID_STATE = "INVALID_STATE";
  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
  private static final String GUARDRAIL_VIOLATION = "GUARDRAIL_VIOLATION";
  private static final String CONFLICT = "CONFLICT";
  private static final String CATEGORY_MESSAGE = "Select an exact OLX leaf category before publishing";
  private static final String CONDITION_MESSAGE = "Choose the product's condition before publishing to OLX";
  private static final String REVIVAL_MESSAGE = "Only an expired listing with an OLX advert can be revived";
  private static final String COST_PRICE_NOTE = "Without a cost price the price floor cannot be checked";
  private static final String SANDBOX_MESSAGE = "Reactivation is not available in sandbox mode";
  private static final String REVIVAL_SANDBOX_MESSAGE = "Revival is not available in sandbox mode";
  private static final String STALE_REVIVAL_MESSAGE =
      "The product or listing changed since the proposal; open the revival again";
  private static final String BELOW_COST_MESSAGE =
      "The advert price is below the cost price; confirm selling below cost to apply it";
  private static final String REQUEST_VALIDATION_MESSAGE = "Request validation failed";
  private static final String NO_PHOTOS_MESSAGE = "Add at least one photo before reviving the advert on OLX";

  @Override
  protected ListingVerification self() {
    return this;
  }

  @Step("Listing has the OLX category {providerCategoryId}")
  public ListingVerification hasOlxCategory(ValidatableResponse response, String providerCategoryId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.marketplaceCategory.providerCategoryId", Matchers.equalTo(providerCategoryId));
    return self();
  }

  @Step("Listing has status {status}")
  public ListingVerification hasStatus(ValidatableResponse response, String status) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.status", Matchers.equalTo(status));
    return self();
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

  @Step("Revival is refused because the product or listing changed since the proposal")
  public ListingVerification isStaleRevivalRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_CONFLICT, CONFLICT);
    response.body("error.message", Matchers.equalTo(STALE_REVIVAL_MESSAGE));
    return self();
  }

  @Step("Revival is refused in sandbox mode")
  public ListingVerification isRevivalSandboxRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, INVALID_STATE);
    response.body("error.message", Matchers.equalTo(REVIVAL_SANDBOX_MESSAGE));
    return self();
  }

  @Step("Revival is refused because the product has no photos")
  public ListingVerification isNoPhotosRevivalRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, INVALID_STATE);
    response.body("error.message", Matchers.equalTo(NO_PHOTOS_MESSAGE));
    return self();
  }

  @Step("Revival is refused at field {field} by the body validation")
  public ListingVerification isFieldValidationRefusal(ValidatableResponse response, String field) {
    failsWith(response, HttpStatus.SC_BAD_REQUEST, VALIDATION_ERROR);
    response.body("error.message", Matchers.equalTo(REQUEST_VALIDATION_MESSAGE));
    response.body("error.details.field", Matchers.hasItem(field));
    return self();
  }

  @Step("Revival is refused because the advert price is below the cost price without confirmation")
  public ListingVerification isBelowCostRefusal(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_UNPROCESSABLE_ENTITY, GUARDRAIL_VIOLATION);
    response.body("error.message", Matchers.equalTo(BELOW_COST_MESSAGE));
    return self();
  }

  private ListingVerification failsWith(ValidatableResponse response, int status, String code) {
    verifyResponseStatusCode(response, status);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }

  @Step("Price sync queued {count} OLX update(s)")
  public ListingVerification queuedOlxUpdates(ValidatableResponse response, int count) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.priceSync.unchanged", Matchers.equalTo(false));
    response.body("data.priceSync.marketplaceUpdates", Matchers.hasSize(count));
    return self();
  }

  @Step("Price sync reports the price unchanged and queues nothing")
  public ListingVerification priceUnchanged(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.priceSync.unchanged", Matchers.equalTo(true));
    response.body("data.priceSync.marketplaceUpdates", Matchers.empty());
    return self();
  }

  @Step("Listing has price {expected}")
  public ListingVerification hasPrice(ValidatableResponse response, double expected) {
    double actual = response.extract().jsonPath().getDouble("data.price");
    MatcherAssert.assertThat(actual, Matchers.closeTo(expected, PRICE_TOLERANCE));
    return self();
  }
}
