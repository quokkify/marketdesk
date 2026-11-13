package dev.quokkify.marketdesk.service;

import java.util.List;

import dev.quokkify.filter.CustomApiTestLogFilter;
import dev.quokkify.marketdesk.config.MarketDeskApiConfig;
import dev.quokkify.service.ApiService;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;

public abstract class MarketDeskApiService extends ApiService {

  private static final String AUTHORIZATION = "Authorization";
  private static final String BEARER = "Bearer ";

  protected RequestSpecification anonymous() {
    return RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON,
        List.of(new CustomApiTestLogFilter(), new TokenRedactingAllureFilter())));
  }

  protected RequestSpecification authorized(String token) {
    if (token == null || token.isBlank()) {
      throw new IllegalArgumentException("The access token is missing");
    }
    return anonymous().header(AUTHORIZATION, BEARER + token);
  }
}
