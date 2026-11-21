package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class ListingService extends MarketDeskApiService {

  private static final String REACTIVATE = "/api/listings/%s/reactivate";
  private static final String PUBLISH = "/api/listings/%s/publish";
  private static final String EMPTY_BODY = "{}";

  public ValidatableResponse reactivate(String token, String listingId) {
    return post(authorized(token), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse reactivate(String listingId) {
    return post(anonymous(), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse publish(String token, String listingId) {
    return post(authorized(token), PUBLISH.formatted(listingId), EMPTY_BODY);
  }
}
