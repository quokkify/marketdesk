package dev.quokkify.marketdesk.verification;

import java.util.Collections;
import java.util.List;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class ProductVerification extends BaseApiVerification<ProductVerification> {

  private static final String OFFLINE_PROVIDER = "offline";
  private static final String COST_NOT_APPLICABLE = "not_applicable";
  private static final double PRICE_TOLERANCE = 0.001;
  private static final String BY_PRODUCT = "data.byProductId.'%s'";
  private static final int STATS_DAYS = 14;

  @Override
  protected ProductVerification self() {
    return this;
  }

  // A whole cost price comes back as a JSON integer, which JsonPath reads as Integer.
  @Step("Product keeps condition {condition} and cost price {costPrice}")
  public ProductVerification hasConditionAndCostPrice(ValidatableResponse response, String condition,
      int costPrice) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.condition", Matchers.equalTo(condition));
    response.body("data.costPrice", Matchers.equalTo(costPrice));
    return self();
  }

  @Step("Exactly one product is named {name}")
  public ProductVerification hasExactlyOneProductNamed(ValidatableResponse response, String name) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    List<String> names = response.extract().jsonPath().getList("data.name", String.class);
    MatcherAssert.assertThat(Collections.frequency(names, name), Matchers.equalTo(1));
    return self();
  }

  @Step("Statistics cover product {productId} with a 14-day trend")
  public ProductVerification statsCoverProduct(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(BY_PRODUCT.formatted(productId) + ".viewsByDay", Matchers.hasSize(STATS_DAYS));
    response.body(BY_PRODUCT.formatted(productId) + ".listingStatus", Matchers.notNullValue());
    return self();
  }

  // The response stage belongs to a live listing; a product whose listing is still a draft has none.
  @Step("Statistics of product {productId} carry no response stage")
  public ProductVerification statsHaveNoResponseStage(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(BY_PRODUCT.formatted(productId), Matchers.hasKey("response"));
    response.body(BY_PRODUCT.formatted(productId) + ".response", Matchers.nullValue());
    return self();
  }

  @Step("Statistics of product {productId} list the needs-action reason {reason}")
  public ProductVerification statsNeedAction(ValidatableResponse response, String productId, String reason) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(BY_PRODUCT.formatted(productId) + ".needsAction", Matchers.hasItem(reason));
    return self();
  }

  @Step("Product {productId} has at least one pending AI suggestion")
  public ProductVerification hasPendingSuggestions(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(BY_PRODUCT.formatted(productId), Matchers.greaterThanOrEqualTo(1));
    return self();
  }

  @Step("Product {productId} has no pending AI suggestions")
  public ProductVerification hasNoPendingSuggestions(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(BY_PRODUCT.formatted(productId), Matchers.nullValue());
    return self();
  }

  @Step("The product list contains product {productId}")
  public ProductVerification listsProduct(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.id", Matchers.hasItem(productId));
    return self();
  }

  @Step("The product list does not contain product {productId}")
  public ProductVerification doesNotListProduct(ValidatableResponse response, String productId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.id", Matchers.not(Matchers.hasItem(productId)));
    return self();
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

  @Step("Product has the lowest acceptable price {expected}")
  public ProductVerification hasMinAcceptablePrice(ValidatableResponse response, double expected) {
    double actual = response.extract().jsonPath().getDouble("data.minAcceptablePrice");
    MatcherAssert.assertThat(actual, Matchers.closeTo(expected, PRICE_TOLERANCE));
    return self();
  }

  @Step("Product has no lowest acceptable price")
  public ProductVerification hasNoMinAcceptablePrice(ValidatableResponse response) {
    response.body("data.minAcceptablePrice", Matchers.nullValue());
    return self();
  }

  @Step("Product has the missing accessories {expected}")
  public ProductVerification hasMissingAccessories(ValidatableResponse response, String expected) {
    response.body("data.missingAccessories", Matchers.equalTo(expected));
    return self();
  }

  // Offline heuristics report no tokens: unknown stays null, never 0.
  @Step("Analysis reports offline AI usage without tokens")
  public ProductVerification reportsOfflineAiUsage(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.aiUsage.provider", Matchers.equalTo(OFFLINE_PROVIDER));
    response.body("data.aiUsage.totalTokens", Matchers.nullValue());
    response.body("data.aiUsage.costStatus", Matchers.equalTo(COST_NOT_APPLICABLE));
    return self();
  }

  @Step("Price sync queued {count} OLX update(s)")
  public ProductVerification queuedOlxUpdates(ValidatableResponse response, int count) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.priceSync.unchanged", Matchers.equalTo(false));
    response.body("data.priceSync.marketplaceUpdates", Matchers.hasSize(count));
    return self();
  }

  @Step("Price sync reports the price unchanged and queues nothing")
  public ProductVerification priceUnchanged(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.priceSync.unchanged", Matchers.equalTo(true));
    response.body("data.priceSync.marketplaceUpdates", Matchers.empty());
    return self();
  }

  @Step("Response carries no price sync")
  public ProductVerification hasNoPriceSync(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.priceSync", Matchers.nullValue());
    return self();
  }

  @Step("Product has selling price {expected}")
  public ProductVerification hasSellingPrice(ValidatableResponse response, double expected) {
    double actual = response.extract().jsonPath().getDouble("data.sellingPrice");
    MatcherAssert.assertThat(actual, Matchers.closeTo(expected, PRICE_TOLERANCE));
    return self();
  }
}
