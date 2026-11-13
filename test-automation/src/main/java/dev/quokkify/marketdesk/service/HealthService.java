package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class HealthService extends MarketDeskApiService {

  private static final String HEALTH = "/health";
  private static final String READY = "/ready";

  public ValidatableResponse getHealth() {
    return get(anonymous(), HEALTH);
  }

  public ValidatableResponse getReadiness() {
    return get(anonymous(), READY);
  }
}
