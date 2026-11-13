package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class ProductService extends MarketDeskApiService {

  private static final String PRODUCTS = "/api/products";

  public ValidatableResponse getProducts(String token) {
    return get(authorized(token), PRODUCTS);
  }

  public ValidatableResponse getProducts() {
    return get(anonymous(), PRODUCTS);
  }
}
