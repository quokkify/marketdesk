package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class AiUsageService extends MarketDeskApiService {

  private static final String USAGE = "/api/hermes/usage";

  public ValidatableResponse getUsage(String token) {
    return get(authorized(token), USAGE);
  }

  public ValidatableResponse getUsage() {
    return get(anonymous(), USAGE);
  }
}
