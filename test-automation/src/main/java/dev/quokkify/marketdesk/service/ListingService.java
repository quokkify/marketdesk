package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.RevivalRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ListingService extends MarketDeskApiService {

  private static final String REACTIVATE = "/api/listings/%s/reactivate";
  private static final String PUBLISH = "/api/listings/%s/publish";
  private static final String REVIVAL_PROPOSAL = "/api/listings/%s/revival-proposal";
  private static final String REVIVE = "/api/listings/%s/revive";
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
