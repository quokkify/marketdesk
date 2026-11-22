package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ProductService extends MarketDeskApiService {

  private static final String PRODUCTS = "/api/products";
  private static final String PRODUCT = PRODUCTS + "/%s";
  private static final String PRICE_PATCH = "{\"%s\": %s}";
  private static final String PRICE_AND_FLOOR_PATCH = "{\"sellingPrice\": %s, \"minAcceptablePrice\": %s}";
  private static final String NAME_PATCH = "{\"name\": \"%s\"}";
  private static final String PRODUCT_LISTINGS = PRODUCTS + "/%s/listings";
  private static final String PRODUCT_STATS = PRODUCTS + "/stats";
  private static final String NEEDS_ACTION_PRODUCTS = PRODUCTS + "?needsAction=true";
  private static final String STATUS_PATCH = "{\"status\": \"%s\"}";
  private static final String HERMES_PENDING_COUNTS = "/api/hermes/events/pending-counts";
  private static final String HERMES_DISMISS = "/api/hermes/events/%s/dismiss";

  public ValidatableResponse getProducts(String token) {
    return get(authorized(token), PRODUCTS);
  }

  public ValidatableResponse getProduct(String token, String productId) {
    return get(authorized(token), PRODUCT.formatted(productId));
  }

  public ValidatableResponse getListings(String token, String productId) {
    return get(authorized(token), PRODUCT_LISTINGS.formatted(productId));
  }

  public ValidatableResponse getProducts() {
    return get(anonymous(), PRODUCTS);
  }

  // A null value is sent as an explicit JSON null, which clears the field.
  public ValidatableResponse updateMinAcceptablePrice(String token, String productId, Double minAcceptablePrice) {
    return patch(authorized(token), PRODUCT.formatted(productId),
        PRICE_PATCH.formatted("minAcceptablePrice", minAcceptablePrice));
  }

  public ValidatableResponse updateSellingPrice(String token, String productId, double sellingPrice) {
    return patch(authorized(token), PRODUCT.formatted(productId), PRICE_PATCH.formatted("sellingPrice", sellingPrice));
  }

  public ValidatableResponse updateSellingPriceAndFloor(String token, String productId, double sellingPrice,
      double minAcceptablePrice) {
    return patch(authorized(token), PRODUCT.formatted(productId),
        PRICE_AND_FLOOR_PATCH.formatted(sellingPrice, minAcceptablePrice));
  }

  public ValidatableResponse updateName(String token, String productId, String name) {
    return patch(authorized(token), PRODUCT.formatted(productId), NAME_PATCH.formatted(name));
  }

  public ValidatableResponse getProductStats(String token) {
    return get(authorized(token), PRODUCT_STATS);
  }

  public ValidatableResponse getProductStats() {
    return get(anonymous(), PRODUCT_STATS);
  }

  public ValidatableResponse getNeedsActionProducts(String token) {
    return get(authorized(token), NEEDS_ACTION_PRODUCTS);
  }

  public ValidatableResponse updateStatus(String token, String productId, String status) {
    return patch(authorized(token), PRODUCT.formatted(productId), STATUS_PATCH.formatted(status));
  }

  public ValidatableResponse getPendingCounts(String token) {
    return get(authorized(token), HERMES_PENDING_COUNTS);
  }

  public ValidatableResponse getPendingCounts() {
    return get(anonymous(), HERMES_PENDING_COUNTS);
  }

  public ValidatableResponse dismissEvent(String token, String eventId) {
    return post(authorized(token), HERMES_DISMISS.formatted(eventId), "{}");
  }

  // Keeps nulls: the API requires costPrice and reads null as an unknown cost price.
  public ValidatableResponse createProduct(String token, ProductRequestPojo body) {
    return post(authorized(token), PRODUCTS, JsonConverter.toJson(body));
  }

  public ValidatableResponse createListing(String token, String productId, ListingRequestPojo body) {
    return post(authorized(token), PRODUCT_LISTINGS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
