package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.config.MarketDeskApiConfig;
import dev.quokkify.service.ApiService;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;

public class ProductService extends ApiService {

  private static final String PRODUCTS = "/api/products";

  public ValidatableResponse getProducts() {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)), PRODUCTS);
  }
}
