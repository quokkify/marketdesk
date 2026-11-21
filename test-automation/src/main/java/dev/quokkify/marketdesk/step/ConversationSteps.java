package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ReplyDraftPojo;
import dev.quokkify.marketdesk.model.ReplyTextPojo;
import dev.quokkify.marketdesk.service.ConversationService;
import dev.quokkify.marketdesk.service.ListingService;
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
  // The availability question the stub OLX adapter puts in every sandbox advert (olxSandboxConversations.ts).
  private static final String AVAILABILITY_THREAD = "data.threads.find { it.messages[0].text.contains('still available') }";
  // Stub thread ids are sbx-<advert id>-<fixture>; the availability fixture is "buyer".
  private static final String SANDBOX_AVAILABILITY_THREAD_ID = "sbx-%s-buyer";
  private static final String MARKETPLACE_LISTING_ID = "data.marketplaceListingId";
  private static final String PENDING = "pending";
  private static final Duration SETTLE_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);

  private final ConversationService service = new ConversationService();
  private final ListingService listingService = new ListingService();

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

  @Step("Read the pending draft of the availability thread")
  public ReplyDraftPojo availabilityDraft(ValidatableResponse response) {
    Map<String, Object> thread = response.statusCode(HttpStatus.SC_OK).extract().jsonPath().getMap(AVAILABILITY_THREAD);
    @SuppressWarnings("unchecked")
    Map<String, Object> draft = (Map<String, Object>) thread.get("draft");
    return new ReplyDraftPojo((String) thread.get("id"), (String) draft.get("id"), (String) draft.get("text"));
  }

  @Step("Send reply draft {draft} with text {text}")
  public ValidatableResponse send(AccountPojo account, ReplyDraftPojo draft, String text) {
    return service.send(account.token(), draft.threadId(), draft.draftId(), new ReplyTextPojo(text));
  }

  @Step("Send reply draft {draft} twice at the same time and read both statuses")
  public List<Integer> sendTwiceAtOnce(AccountPojo account, ReplyDraftPojo draft) {
    List<CompletableFuture<Integer>> calls = List.of(
        CompletableFuture.supplyAsync(() -> sendStatus(account, draft)),
        CompletableFuture.supplyAsync(() -> sendStatus(account, draft)));
    return calls.stream().map(CompletableFuture::join).sorted().toList();
  }

  @Step("Dismiss reply draft {draft}")
  public ValidatableResponse dismiss(AccountPojo account, ReplyDraftPojo draft) {
    return service.dismiss(account.token(), draft.threadId(), draft.draftId());
  }

  @Step("Regenerate the reply of thread {threadId}")
  public ValidatableResponse regenerate(AccountPojo account, String threadId) {
    return service.regenerate(account.token(), threadId);
  }

  @Step("Get the count of threads awaiting an answer per product")
  public ValidatableResponse getAwaiting(AccountPojo account) {
    return service.getAwaiting(account.token());
  }

  @Step("The sandbox buyer of the availability thread on listing {listing} writes {text}")
  public void sandboxBuyerWrites(AccountPojo account, ProductListingPojo listing, String text) {
    addSandboxBuyerMessage(account, account, listing, text).statusCode(HttpStatus.SC_CREATED);
  }

  @Step("Add a sandbox buyer message to the availability thread of {owner}'s listing {listing} as {caller}")
  public ValidatableResponse addSandboxBuyerMessage(AccountPojo caller, AccountPojo owner, ProductListingPojo listing,
      String text) {
    String advertId = listingService.getListing(owner.token(), listing.listingId())
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .path(MARKETPLACE_LISTING_ID);
    return service.addSandboxBuyerMessage(caller.token(), SANDBOX_AVAILABILITY_THREAD_ID.formatted(advertId),
        new ReplyTextPojo(text));
  }

  // Regeneration is queued, so the new draft arrives a little later.
  @Step("Wait until the availability thread of product {productId} has a pending draft other than {previous}")
  public ReplyDraftPojo awaitNewAvailabilityDraft(AccountPojo account, String productId, ReplyDraftPojo previous) {
    Waiter.awaitCondition(() -> isNewPendingDraft(service.getConversations(account.token(), productId), previous),
        "the availability thread has a new pending draft", SETTLE_TIMEOUT, POLL_INTERVAL);
    return availabilityDraft(service.getConversations(account.token(), productId));
  }

  private int sendStatus(AccountPojo account, ReplyDraftPojo draft) {
    return service.send(account.token(), draft.threadId(), draft.draftId(), new ReplyTextPojo(draft.text()))
        .extract()
        .statusCode();
  }

  private static boolean isNewPendingDraft(ValidatableResponse response, ReplyDraftPojo previous) {
    if (response.extract().statusCode() != HttpStatus.SC_OK) {
      return false;
    }
    Map<String, Object> draft = response.extract().jsonPath().getMap(AVAILABILITY_THREAD + ".draft");
    return draft != null && PENDING.equals(draft.get("status")) && !Objects.equals(previous.draftId(), draft.get("id"));
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
