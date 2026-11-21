package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class HermesLimitsService extends MarketDeskApiService {

  private static final String LIMITS = "/api/hermes/limits";

  public ValidatableResponse getLimits(String token) {
    return get(authorized(token), LIMITS);
  }

  public ValidatableResponse getLimits() {
    return get(anonymous(), LIMITS);
  }
}
