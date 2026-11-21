package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class PriceResearchVerification extends BaseApiVerification<PriceResearchVerification> {

  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";

  @Override
  protected PriceResearchVerification self() {
    return this;
  }

  @Step("Price research holds the saved retail anchor and comparables")
  public PriceResearchVerification holds(ValidatableResponse response, PriceResearchPojo expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.retailPrice", Matchers.equalTo(expected.retailPrice().floatValue()));
    response.body("data.retailCurrency", Matchers.equalTo(expected.retailCurrency()));
    response.body("data.retailSource", Matchers.equalTo(expected.retailSource()));
    response.body("data.retailCheckedAt", Matchers.equalTo(expected.retailCheckedAt()));
    // A whole price such as 250 comes back as a JSON integer, so read the list as doubles.
    MatcherAssert.assertThat(response.extract().jsonPath().getList("data.comparables.price", Double.class),
        Matchers.contains(expected.comparables().stream().map(PriceResearchPojo.Comparable::price).toArray()));
    response.body("data.comparables.note", Matchers.contains(
        expected.comparables().stream().map(PriceResearchPojo.Comparable::note).toArray()));
    return self();
  }

  @Step("Price research has no retail anchor")
  public PriceResearchVerification hasNoRetailAnchor(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.retailPrice", Matchers.nullValue());
    response.body("data.retailCurrency", Matchers.nullValue());
    response.body("data.retailSource", Matchers.nullValue());
    response.body("data.retailCheckedAt", Matchers.nullValue());
    return self();
  }

  // The API stack has no Hermes, so the offline estimate has low confidence and must stay silent.
  @Step("Analysis ran and proposes no price change and no price estimate notice")
  public PriceResearchVerification proposesNoPriceChange(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
    response.body("success", Matchers.equalTo(true));
    response.body("data", Matchers.not(Matchers.empty()));
    response.body("data.proposedChange.kind", Matchers.not(Matchers.hasItem("price")));
    response.body("data.type", Matchers.not(Matchers.hasItem("price_estimate_unavailable")));
    return self();
  }

  @Step("Request is rejected as invalid")
  public PriceResearchVerification isInvalid(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_BAD_REQUEST, VALIDATION_ERROR);
  }

  @Step("Product is not found")
  public PriceResearchVerification isNotFound(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_NOT_FOUND, NOT_FOUND);
  }

  @Step("Request is rejected as unauthenticated")
  public PriceResearchVerification isUnauthenticated(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_UNAUTHORIZED, UNAUTHORIZED);
  }

  private PriceResearchVerification failsWith(ValidatableResponse response, int status, String code) {
    verifyResponseStatusCode(response, status);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }
}
