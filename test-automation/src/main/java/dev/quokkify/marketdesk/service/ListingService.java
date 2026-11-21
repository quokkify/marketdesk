package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.MarketplaceCategoryRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ListingService extends MarketDeskApiService {

  private static final String LISTING = "/api/listings/%s";
  private static final String REACTIVATE = LISTING + "/reactivate";
  private static final String PUBLISH = LISTING + "/publish";
  private static final String MARKETPLACE_CATEGORY = LISTING + "/marketplace-category";
  private static final String EMPTY_BODY = "{}";

  public ValidatableResponse reactivate(String token, String listingId) {
    return post(authorized(token), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse reactivate(String listingId) {
    return post(anonymous(), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse getListing(String token, String listingId) {
    return get(authorized(token), LISTING.formatted(listingId));
  }

  public ValidatableResponse setMarketplaceCategory(String token, String listingId,
      MarketplaceCategoryRequestPojo body) {
    return put(authorized(token), MARKETPLACE_CATEGORY.formatted(listingId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse publish(String token, String listingId) {
    return post(authorized(token), PUBLISH.formatted(listingId), EMPTY_BODY);
  }
}
