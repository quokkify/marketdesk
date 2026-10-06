package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.config.MarketDeskApiConfig;
import dev.quokkify.service.ApiService;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;

public class HealthService extends ApiService {

  private static final String HEALTH = "/health";
  private static final String READY = "/ready";

  public ValidatableResponse getHealth() {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)), HEALTH);
  }

  public ValidatableResponse getReadiness() {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)), READY);
  }
}
