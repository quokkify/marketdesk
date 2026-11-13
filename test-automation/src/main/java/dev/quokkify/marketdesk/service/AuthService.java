package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.config.MarketDeskApiConfig;
import dev.quokkify.marketdesk.model.CredentialsPojo;
import dev.quokkify.marketdesk.model.RegistrationPojo;
import dev.quokkify.service.ApiService;
import dev.quokkify.util.JsonConverter;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;

public class AuthService extends ApiService {

  private static final String REGISTER = "/api/auth/register";
  private static final String LOGIN = "/api/auth/login";
  private static final String ME = "/api/auth/me";
  private static final String AUTHORIZATION = "Authorization";
  private static final String BEARER = "Bearer ";

  public ValidatableResponse register(RegistrationPojo body) {
    return post(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)),
        REGISTER, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse login(CredentialsPojo body) {
    return post(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON)),
        LOGIN, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse getCurrentUser(String token) {
    return get(RestAssured.given().spec(getRequestSpecification(MarketDeskApiConfig.BASE_URI, ContentType.JSON))
        .header(AUTHORIZATION, BEARER + token), ME);
  }
}
