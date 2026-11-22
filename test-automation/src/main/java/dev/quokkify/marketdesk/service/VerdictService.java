package dev.quokkify.marketdesk.service;

import java.util.List;
import java.util.Map;

import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class VerdictService extends MarketDeskApiService {

  private static final String HERMES_RUN = "/api/hermes/products/%s/run";
  private static final String VERDICT = "/api/hermes/products/%s/verdict";
  private static final String RECHECK = "/api/products/%s/recheck";
  private static final String HERMES_SETTINGS = "/api/settings/hermes";
  private static final String EMPTY_BODY = "{}";
  private static final String SEO_ENABLED_PATCH = "{\"agents\": {\"listingSeo\": {\"enabled\": true}}}";

  public ValidatableResponse runAnalyze(String token, String productId) {
    return post(authorized(token), HERMES_RUN.formatted(productId), EMPTY_BODY);
  }

  public ValidatableResponse runScope(String token, String productId, List<String> scope) {
    return post(authorized(token), HERMES_RUN.formatted(productId), JsonConverter.toJson(Map.of("scope", scope)));
  }

  public ValidatableResponse runAnalyze(String productId) {
    return post(anonymous(), HERMES_RUN.formatted(productId), EMPTY_BODY);
  }

  public ValidatableResponse getVerdict(String token, String productId) {
    return get(authorized(token), VERDICT.formatted(productId));
  }

  public ValidatableResponse getVerdict(String productId) {
    return get(anonymous(), VERDICT.formatted(productId));
  }

  public ValidatableResponse recheck(String token, String productId, String listingId) {
    return post(authorized(token), RECHECK.formatted(productId), JsonConverter.toJson(Map.of("listingId", listingId)));
  }

  public ValidatableResponse enableListingSeo(String token) {
    return patch(authorized(token), HERMES_SETTINGS, SEO_ENABLED_PATCH);
  }
}
