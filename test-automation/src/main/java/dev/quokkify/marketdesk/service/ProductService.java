package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ProductService extends MarketDeskApiService {

  private static final String PRODUCTS = "/api/products";
  private static final String PRODUCT_LISTINGS = PRODUCTS + "/%s/listings";

  public ValidatableResponse getProducts(String token) {
    return get(authorized(token), PRODUCTS);
  }

  public ValidatableResponse getProducts() {
    return get(anonymous(), PRODUCTS);
  }

  public ValidatableResponse createProduct(String token, ProductRequestPojo body) {
    return post(authorized(token), PRODUCTS, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse createListing(String token, String productId, ListingRequestPojo body) {
    return post(authorized(token), PRODUCT_LISTINGS.formatted(productId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
