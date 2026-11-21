package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.model.ReplyDraftPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

// Sandbox OLX threads and offline drafts (see ConversationSyncTest). The sample product sells for 100 with no
// lower floor, so a reply naming 50 zł offers less than the floor.
public class ReplySendTest extends BaseTest {

  private static final int SANDBOX_THREADS = 3;
  private static final String BELOW_FLOOR_REPLY = "Ok, 50 zł and it is yours.";
  private static final String LINK_REPLY = "Details here: https://example.com/camera";
  private static final String BUYER_FOLLOW_UP = "Hello? Are you there?";
  private static final String SUPERSEDED = "superseded";
  private static final String BELOW_FLOOR = "below_floor";
  private static final String LINK = "link";
  private static final String PENDING = "pending";
  private static final String DISMISSED = "dismissed";

  @Test
  public void sendMarksDraftSentAndAppendsMessage() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    ValidatableResponse sent = conversationSteps.send(owner, draft, draft.text());
    conversationSteps.verify().replyIsSent(sent, draft.text());
  }

  @Test
  public void sendTwiceSendsOnce() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    String firstSyncAt = marketplaceSteps.awaitOlxLastSyncAt(owner);

    conversationSteps.verify().sentOnce(conversationSteps.sendTwiceAtOnce(owner, draft));

    // A resync stores whatever the stub OLX thread holds, so a second send would show up here.
    marketplaceSteps.resyncOlx(owner, firstSyncAt);
    conversationSteps.verify().availabilityThreadHasSellerMessages(
        conversationSteps.getConversations(owner, listing.productId()), 1);
  }

  @Test
  public void sendSupersededWhenBuyerWroteAgain() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    conversationSteps.sandboxBuyerWrites(owner, listing, BUYER_FOLLOW_UP);

    conversationSteps.verify()
        .conflictsWith(conversationSteps.send(owner, draft, draft.text()), SUPERSEDED)
        .availabilityThreadHasSellerMessages(conversationSteps.getConversations(owner, listing.productId()), 0);
  }

  @Test
  public void sandboxBuyerMessageIsWorkspaceScoped() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS);
    AccountPojo stranger = authSteps.registerNewAccount();

    conversationSteps.verify().isNotFound(
        conversationSteps.addSandboxBuyerMessage(stranger, owner, listing, BUYER_FOLLOW_UP));
  }

  @Test
  public void sendRejectsEditedTextBelowFloor() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    conversationSteps.verify()
        .breaksDraftRule(conversationSteps.send(owner, draft, BELOW_FLOOR_REPLY), BELOW_FLOOR)
        .availabilityDraftIs(conversationSteps.getConversations(owner, listing.productId()), PENDING);
  }

  @Test
  public void sendRejectsEditedTextWithLink() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    conversationSteps.verify()
        .breaksDraftRule(conversationSteps.send(owner, draft, LINK_REPLY), LINK)
        .availabilityDraftIs(conversationSteps.getConversations(owner, listing.productId()), PENDING);
  }

  @Test
  public void dismissHidesDraft() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    conversationSteps.verify().awaitingCount(conversationSteps.getAwaiting(owner), listing.productId(), 2);

    conversationSteps.dismiss(owner, draft);

    conversationSteps.verify()
        .availabilityDraftIs(conversationSteps.getConversations(owner, listing.productId()), DISMISSED)
        .awaitingCount(conversationSteps.getAwaiting(owner), listing.productId(), 1);
  }

  @Test
  public void regenerateCreatesNewDraft() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ReplyDraftPojo draft = conversationSteps.availabilityDraft(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));

    conversationSteps.verify().isAccepted(conversationSteps.regenerate(owner, draft.threadId()));

    conversationSteps.verify().isNewDraft(
        conversationSteps.awaitNewAvailabilityDraft(owner, listing.productId(), draft), draft);
  }
}
