package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.service.ConversationService;
import dev.quokkify.marketdesk.verification.ConversationVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class ConversationSteps extends ApiSteps<ConversationVerification> {

  private static final String THREADS = "data.threads";
  private static final String DRAFT_IDS = "data.threads.findAll { it.draft != null }.draft.id";
  private static final String SUSPICIOUS = "suspicious";
  private static final Duration SETTLE_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);

  private final ConversationService service = new ConversationService();

  public ConversationSteps() {
    this.verification = new ConversationVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Get the conversations of product {productId}")
  public ValidatableResponse getConversations(AccountPojo account, String productId) {
    return service.getConversations(account.token(), productId);
  }

  // Reply runs are queued by the sync, so a thread gets its draft or its screening verdict a little later.
  @Step("Wait until product {productId} has {expectedThreads} threads, each screened as suspicious or drafted")
  public ValidatableResponse awaitSettledThreads(AccountPojo account, String productId, int expectedThreads) {
    Waiter.awaitCondition(() -> isSettled(service.getConversations(account.token(), productId), expectedThreads),
        "every conversation thread is screened or drafted", SETTLE_TIMEOUT, POLL_INTERVAL);
    return service.getConversations(account.token(), productId);
  }

  @Step("Read the draft ids of the conversation threads")
  public List<String> draftIds(ValidatableResponse response) {
    return response.statusCode(HttpStatus.SC_OK)
        .extract()
        .jsonPath()
        .getList(DRAFT_IDS, String.class)
        .stream()
        .sorted()
        .toList();
  }

  private static boolean isSettled(ValidatableResponse response, int expectedThreads) {
    if (response.extract().statusCode() != HttpStatus.SC_OK) {
      return false;
    }
    List<Map<String, Object>> threads = response.extract().jsonPath().getList(THREADS);
    return threads != null && threads.size() == expectedThreads
        && threads.stream().allMatch(thread -> thread.get("draft") != null || SUSPICIOUS.equals(thread.get("status")));
  }
}
