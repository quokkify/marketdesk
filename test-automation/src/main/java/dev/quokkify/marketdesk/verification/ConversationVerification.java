package dev.quokkify.marketdesk.verification;

import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;

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
