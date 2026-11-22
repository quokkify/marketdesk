package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.config.HermesMockConfig;
import dev.quokkify.marketdesk.model.MockServerExpectationPojo;
import dev.quokkify.marketdesk.model.MockServerVerificationPojo;
import dev.quokkify.service.ApiService;
import dev.quokkify.util.JsonConverter;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;

// The control API of the MockServer that stands in for the Hermes research profile.
public class HermesMockService extends ApiService {

  private static final String EXPECTATION = "/mockserver/expectation";
  private static final String VERIFY = "/mockserver/verify";

  public ValidatableResponse createExpectation(MockServerExpectationPojo expectation) {
    return put(mockServer(), EXPECTATION, JsonConverter.toJsonIgnoreNulls(expectation));
  }

  public ValidatableResponse verify(MockServerVerificationPojo verification) {
    return put(mockServer(), VERIFY, JsonConverter.toJsonIgnoreNulls(verification));
  }

  private RequestSpecification mockServer() {
    return RestAssured.given().spec(getRequestSpecification(HermesMockConfig.BASE_URI, ContentType.JSON));
  }
}
