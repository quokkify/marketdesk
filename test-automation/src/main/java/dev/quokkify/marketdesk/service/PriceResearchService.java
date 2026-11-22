package dev.quokkify.marketdesk.service;

import java.util.Map;

import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class PriceResearchService extends MarketDeskApiService {

  private static final String PRICE_RESEARCH = "/api/products/%s/price-research";
  private static final String PRICE_RESEARCH_REFRESH = "/api/products/%s/price-research/refresh";
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

  public ValidatableResponse putPriceResearch(String token, String productId, Map<String, Object> body) {
    return put(authorized(token), PRICE_RESEARCH.formatted(productId), JsonConverter.toJson(body));
  }

  public ValidatableResponse putPriceResearch(String productId, PriceResearchPojo body) {
    return put(anonymous(), PRICE_RESEARCH.formatted(productId), JsonConverter.toJson(body));
  }

  public ValidatableResponse refreshPriceResearch(String token, String productId) {
    return post(authorized(token), PRICE_RESEARCH_REFRESH.formatted(productId), EMPTY_BODY);
  }

  public ValidatableResponse refreshPriceResearch(String productId) {
    return post(anonymous(), PRICE_RESEARCH_REFRESH.formatted(productId), EMPTY_BODY);
  }
}
