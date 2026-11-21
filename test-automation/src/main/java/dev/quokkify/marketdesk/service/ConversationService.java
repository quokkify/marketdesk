package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.ReplyTextPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class ConversationService extends MarketDeskApiService {

  private static final String PRODUCT_CONVERSATIONS = "/api/products/%s/conversations";
  private static final String DRAFT = "/api/conversations/%s/drafts/%s";
  private static final String SEND = DRAFT + "/send";
  private static final String DISMISS = DRAFT + "/dismiss";
  private static final String REGENERATE = "/api/conversations/%s/regenerate";
  private static final String AWAITING = "/api/conversations/awaiting";
  private static final String SANDBOX_BUYER_MESSAGE = "/api/sandbox/olx/threads/%s/buyer-message";
  private static final String EMPTY_BODY = "{}";

  public ValidatableResponse getConversations(String token, String productId) {
    return get(authorized(token), PRODUCT_CONVERSATIONS.formatted(productId));
  }

  public ValidatableResponse send(String token, String threadId, String draftId, ReplyTextPojo body) {
    return post(authorized(token), SEND.formatted(threadId, draftId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse dismiss(String token, String threadId, String draftId) {
    return post(authorized(token), DISMISS.formatted(threadId, draftId), EMPTY_BODY);
  }

  public ValidatableResponse regenerate(String token, String threadId) {
    return post(authorized(token), REGENERATE.formatted(threadId), EMPTY_BODY);
  }

  public ValidatableResponse getAwaiting(String token) {
    return get(authorized(token), AWAITING);
  }

  public ValidatableResponse addSandboxBuyerMessage(String token, String externalThreadId, ReplyTextPojo body) {
    return post(authorized(token), SANDBOX_BUYER_MESSAGE.formatted(externalThreadId),
        JsonConverter.toJsonIgnoreNulls(body));
  }
}
