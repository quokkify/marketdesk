package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.ImprovementRequestPojo;
import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ProductService extends MarketDeskApiService {

  private static final String PRODUCTS = "/api/products";
  private static final String PRODUCT = PRODUCTS + "/%s";
  private static final String PRODUCT_LISTINGS = PRODUCTS + "/%s/listings";
  private static final String PRODUCT_IMPROVEMENTS = PRODUCTS + "/%s/improvements";

  public ValidatableResponse getProducts(String token) {
    return get(authorized(token), PRODUCTS);
  }

  public ValidatableResponse getProducts() {
    return get(anonymous(), PRODUCTS);
  }

  public ValidatableResponse getProduct(String token, String productId) {
    return get(authorized(token), PRODUCT.formatted(productId));
  }

  public ValidatableResponse createProduct(String token, ProductRequestPojo body) {
    return post(authorized(token), PRODUCTS, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse createListing(String token, String productId, ListingRequestPojo body) {
    return post(authorized(token), PRODUCT_LISTINGS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse proposeImprovements(String token, String productId, ImprovementRequestPojo body) {
    return post(authorized(token), PRODUCT_IMPROVEMENTS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
