package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.config.MarketDeskApiConfig;
import dev.quokkify.service.ApiService;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;

public class ProductService extends ApiService {

  private static final String PRODUCTS = "/api/products";

  private static final String AUTHORIZATION = "Authorization";
  private static final String BEARER = "Bearer ";

  public ValidatableResponse getProducts(String token) {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON))
        .header(AUTHORIZATION, BEARER + token), PRODUCTS);
  }

  public ValidatableResponse getProducts() {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)), PRODUCTS);
  }
}
