package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class PriceResearchService extends MarketDeskApiService {

  private static final String PRICE_RESEARCH = "/api/products/%s/price-research";
  private static final String COMPARABLE_SEARCH = "/api/products/%s/price-research/search";
  private static final String HERMES_RUN = "/api/hermes/products/%s/run";
  private static final String EMPTY_BODY = "{}";

  public ValidatableResponse getPriceResearch(String token, String productId) {
    return get(authorized(token), PRICE_RESEARCH.formatted(productId));
  }

  public ValidatableResponse getPriceResearch(String productId) {
    return get(anonymous(), PRICE_RESEARCH.formatted(productId));
  }

  // Keeps nulls: a null retail field clears the stored value.
  public ValidatableResponse putPriceResearch(String token, String productId, PriceResearchPojo body) {
    return put(authorized(token), PRICE_RESEARCH.formatted(productId), JsonConverter.toJson(body));
  }

  public ValidatableResponse putPriceResearch(String productId, PriceResearchPojo body) {
    return put(anonymous(), PRICE_RESEARCH.formatted(productId), JsonConverter.toJson(body));
  }

  // The analyze button of the product page: the body only names the trigger.
  public ValidatableResponse runProductAnalysis(String token, String productId) {
    return post(authorized(token), HERMES_RUN.formatted(productId), EMPTY_BODY);
  }

  public ValidatableResponse searchComparables(String token, String productId) {
    return post(authorized(token), COMPARABLE_SEARCH.formatted(productId), EMPTY_BODY);
  }

  public ValidatableResponse searchComparables(String productId) {
    return post(anonymous(), COMPARABLE_SEARCH.formatted(productId), EMPTY_BODY);
  }
}
