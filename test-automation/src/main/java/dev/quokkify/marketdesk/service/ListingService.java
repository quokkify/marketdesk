package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.MarketplaceCategoryRequestPojo;
import dev.quokkify.marketdesk.model.RevivalRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ListingService extends MarketDeskApiService {

  private static final String LISTING = "/api/listings/%s";
  private static final String REACTIVATE = LISTING + "/reactivate";
  private static final String PUBLISH = LISTING + "/publish";
  private static final String MARKETPLACE_CATEGORY = LISTING + "/marketplace-category";
  private static final String REVIVAL_PROPOSAL = LISTING + "/revival-proposal";
  private static final String REVIVE = LISTING + "/revive";
  private static final String EMPTY_BODY = "{}";
  private static final String PRICE_PATCH = "{\"price\": %s}";

  public ValidatableResponse reactivate(String token, String listingId) {
    return post(authorized(token), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse reactivate(String listingId) {
    return post(anonymous(), REACTIVATE.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse getListing(String token, String listingId) {
    return get(authorized(token), LISTING.formatted(listingId));
  }

  public ValidatableResponse updatePrice(String token, String listingId, double price) {
    return patch(authorized(token), LISTING.formatted(listingId), PRICE_PATCH.formatted(price));
  }

  public ValidatableResponse setMarketplaceCategory(String token, String listingId,
      MarketplaceCategoryRequestPojo body) {
    return put(authorized(token), MARKETPLACE_CATEGORY.formatted(listingId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse publish(String token, String listingId) {
    return post(authorized(token), PUBLISH.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse revivalProposal(String token, String listingId) {
    return post(authorized(token), REVIVAL_PROPOSAL.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse revivalProposal(String listingId) {
    return post(anonymous(), REVIVAL_PROPOSAL.formatted(listingId), EMPTY_BODY);
  }

  public ValidatableResponse revive(String token, String listingId, RevivalRequestPojo body) {
    return post(authorized(token), REVIVE.formatted(listingId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse revive(String listingId, RevivalRequestPojo body) {
    return post(anonymous(), REVIVE.formatted(listingId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
