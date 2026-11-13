package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.CredentialsPojo;
import dev.quokkify.marketdesk.model.RegistrationPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class AuthService extends MarketDeskApiService {

  private static final String REGISTER = "/api/auth/register";
  private static final String LOGIN = "/api/auth/login";
  private static final String ME = "/api/auth/me";

  public ValidatableResponse register(RegistrationPojo body) {
    return post(anonymous(), REGISTER, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse login(CredentialsPojo body) {
    return post(anonymous(), LOGIN, JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse getCurrentUser(String token) {
    return get(authorized(token), ME);
  }
}
