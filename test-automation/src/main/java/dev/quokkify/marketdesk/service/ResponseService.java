package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

// The listing response endpoints: "Why no response?" runs and their view.
public class ResponseService extends MarketDeskApiService {

  private static final String RESPONSE_RUN = "/api/hermes/products/%s/response-run";
  private static final String RESPONSE = "/api/hermes/products/%s/response";

  public ValidatableResponse requestRun(String token, String productId) {
    return post(authorized(token), RESPONSE_RUN.formatted(productId));
  }

  public ValidatableResponse getView(String token, String productId) {
    return get(authorized(token), RESPONSE.formatted(productId));
  }
}
