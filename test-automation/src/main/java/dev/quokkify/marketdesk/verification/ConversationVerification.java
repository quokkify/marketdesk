package dev.quokkify.marketdesk.verification;

import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;

import dev.quokkify.marketdesk.model.ReplyDraftPojo;
import dev.quokkify.util.Waiter;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class ConversationVerification extends BaseApiVerification<ConversationVerification> {

  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String THREADS = "data.threads";
  // The sandbox fixture texts the stub OLX adapter gives every advert (olxSandboxConversations.ts).
  private static final String SCAM_THREAD = "data.threads.find { it.messages[0].text.contains('olx-dostawa') }";
  private static final String HAGGLE_THREAD = "data.threads.find { it.messages[0].text.contains('Would you take') }";
  private static final String AVAILABILITY_THREAD = "data.threads.find { it.messages[0].text.contains('still available') }";
  private static final String SENT_THREAD = "data.thread";
  private static final String SELLER = "seller";
  private static final double PRICE_TOLERANCE = 0.001;
  private static final Duration QUIET_PERIOD = Duration.ofSeconds(6);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);

  @Override
  protected ConversationVerification self() {
    return this;
  }

  @Step("Product has {expected} conversation threads")
  public ConversationVerification hasThreadCount(ValidatableResponse response, int expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(THREADS, Matchers.hasSize(expected));
    return self();
  }

  @Step("The scam thread is suspicious for {reason} and has no draft")
  public ConversationVerification scamThreadIsSuspicious(ValidatableResponse response, String reason) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(SCAM_THREAD + ".status", Matchers.equalTo("suspicious"));
    response.body(SCAM_THREAD + ".suspiciousReasons", Matchers.hasItem(reason));
    response.body(SCAM_THREAD + ".draft", Matchers.nullValue());
    return self();
  }

  // The buyer offers less than the floor, so the draft must counter with the floor itself.
  @Step("The haggle thread has a pending haggle draft offering the floor {floor}")
  public ConversationVerification haggleDraftOffersFloor(ValidatableResponse response, double floor) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(HAGGLE_THREAD + ".draft.status", Matchers.equalTo("pending"));
    response.body(HAGGLE_THREAD + ".draft.intent", Matchers.equalTo("haggle"));
    double price = response.extract().jsonPath().getDouble(HAGGLE_THREAD + ".draft.filledPrice");
    MatcherAssert.assertThat(price, Matchers.closeTo(floor, PRICE_TOLERANCE));
    return self();
  }

  @Step("The reply is sent with text {text} and appended to the thread")
  public ConversationVerification replyIsSent(ValidatableResponse response, String text) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(SENT_THREAD + ".draft.status", Matchers.equalTo("sent"));
    response.body(SENT_THREAD + ".draft.text", Matchers.equalTo(text));
    response.body(SENT_THREAD + ".messages[-1].direction", Matchers.equalTo(SELLER));
    response.body(SENT_THREAD + ".messages[-1].text", Matchers.equalTo(text));
    return self();
  }

  @Step("One of two simultaneous sends succeeds and the other conflicts")
  public ConversationVerification sentOnce(List<Integer> statuses) {
    MatcherAssert.assertThat(statuses, Matchers.contains(HttpStatus.SC_OK, HttpStatus.SC_CONFLICT));
    return self();
  }

  @Step("The availability thread holds {expected} seller messages")
  public ConversationVerification availabilityThreadHasSellerMessages(ValidatableResponse response, int expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(AVAILABILITY_THREAD + ".messages.findAll { it.direction == 'seller' }", Matchers.hasSize(expected));
    return self();
  }

  @Step("The availability draft is {status}")
  public ConversationVerification availabilityDraftIs(ValidatableResponse response, String status) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body(AVAILABILITY_THREAD + ".draft.status", Matchers.equalTo(status));
    return self();
  }

  @Step("The request conflicts with code {code}")
  public ConversationVerification conflictsWith(ValidatableResponse response, String code) {
    verifyResponseStatusCode(response, HttpStatus.SC_CONFLICT);
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }

  @Step("The reply breaks the draft rule {rule}")
  public ConversationVerification breaksDraftRule(ValidatableResponse response, String rule) {
    verifyResponseStatusCode(response, HttpStatus.SC_UNPROCESSABLE_ENTITY);
    response.body("error.code", Matchers.equalTo("draft_rule"));
    response.body("error.details.rule", Matchers.equalTo(rule));
    return self();
  }

  @Step("The request is accepted")
  public ConversationVerification isAccepted(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
    return self();
  }

  @Step("Product {productId} has {expected} threads awaiting an answer")
  public ConversationVerification awaitingCount(ValidatableResponse response, String productId, int expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.byProductId['" + productId + "']", Matchers.equalTo(expected));
    return self();
  }

  @Step("A different draft {next} replaced draft {previous}")
  public ConversationVerification isNewDraft(ReplyDraftPojo next, ReplyDraftPojo previous) {
    MatcherAssert.assertThat(next.draftId(), Matchers.not(Matchers.equalTo(previous.draftId())));
    return self();
  }

  @Step("Conversations are not found")
  public ConversationVerification isNotFound(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_NOT_FOUND);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(NOT_FOUND));
    return self();
  }

  @Step("The drafts stay {expected} while the reply queue drains")
  public ConversationVerification draftsStayUnchanged(Supplier<List<String>> current, List<String> expected) {
    Waiter.assertAlwaysTrue(() -> expected.equals(current.get()), QUIET_PERIOD, POLL_INTERVAL,
        "a resync replaced or added drafts");
    return self();
  }
}
