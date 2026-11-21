package dev.quokkify.marketdesk.test.api;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

// The API test stack runs OLX in stub mode and the AI offline: every sandbox advert has three buyer threads
// (an availability question, a haggle offering 50 zł and a scam link), and reply drafts come from the offline
// templates. The sample product sells for 100.
public class ConversationSyncTest extends BaseTest {

  private static final int SANDBOX_THREADS = 3;
  private static final double FLOOR = 70.0;
  private static final String FOREIGN_LINK = "foreign_link";

  @Test
  public void syncImportsSandboxThreads() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ValidatableResponse conversations = conversationSteps.awaitSettledThreads(owner, listing.productId(),
        SANDBOX_THREADS);
    conversationSteps.verify().hasThreadCount(conversations, SANDBOX_THREADS);
  }

  @Test
  public void scamThreadIsSuspiciousWithoutDraft() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    ValidatableResponse conversations = conversationSteps.awaitSettledThreads(owner, listing.productId(),
        SANDBOX_THREADS);
    conversationSteps.verify().scamThreadIsSuspicious(conversations, FOREIGN_LINK);
  }

  @Test
  public void haggleThreadGetsPendingDraftWithoutLowerPrice() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    productSteps.updateMinAcceptablePrice(owner, listing.productId(), FLOOR);
    marketplaceSteps.syncOlx(owner);
    ValidatableResponse conversations = conversationSteps.awaitSettledThreads(owner, listing.productId(),
        SANDBOX_THREADS);
    conversationSteps.verify().haggleDraftOffersFloor(conversations, FLOOR);
  }

  @Test
  public void conversationsAreWorkspaceScoped() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS);
    AccountPojo stranger = authSteps.registerNewAccount();
    conversationSteps.verify().isNotFound(conversationSteps.getConversations(stranger, listing.productId()));
  }

  @Test
  public void resyncDoesNotDuplicateDrafts() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(owner, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(owner);
    List<String> drafts = conversationSteps.draftIds(
        conversationSteps.awaitSettledThreads(owner, listing.productId(), SANDBOX_THREADS));
    String firstSyncAt = marketplaceSteps.awaitOlxLastSyncAt(owner);

    marketplaceSteps.resyncOlx(owner, firstSyncAt);

    conversationSteps.verify()
        .draftsStayUnchanged(
            () -> conversationSteps.draftIds(conversationSteps.getConversations(owner, listing.productId())), drafts)
        .hasThreadCount(conversationSteps.getConversations(owner, listing.productId()), SANDBOX_THREADS);
  }
}
