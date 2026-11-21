package dev.quokkify.marketdesk.service;

import io.restassured.response.ValidatableResponse;

public class ConversationService extends MarketDeskApiService {

  private static final String PRODUCT_CONVERSATIONS = "/api/products/%s/conversations";

  public ValidatableResponse getConversations(String token, String productId) {
    return get(authorized(token), PRODUCT_CONVERSATIONS.formatted(productId));
  }
}
