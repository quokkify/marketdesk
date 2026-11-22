package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.ImprovementRequestPojo;
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
  private static final String PRODUCT_IMPROVEMENTS = PRODUCTS + "/%s/improvements";

  public ValidatableResponse getProducts(String token) {
    return get(authorized(token), PRODUCTS);
  }

  public ValidatableResponse getProduct(String token, String productId) {
    return get(authorized(token), PRODUCT.formatted(productId));
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

  // Keeps nulls: the API requires costPrice and reads null as an unknown cost price.
  public ValidatableResponse createProduct(String token, ProductRequestPojo body) {
    return post(authorized(token), PRODUCTS, JsonConverter.toJson(body));
  }

  public ValidatableResponse createListing(String token, String productId, ListingRequestPojo body) {
    return post(authorized(token), PRODUCT_LISTINGS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse proposeImprovements(String token, String productId, ImprovementRequestPojo body) {
    return post(authorized(token), PRODUCT_IMPROVEMENTS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
