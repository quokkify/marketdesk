package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// Sandbox OLX threads with offline drafts (see ConversationSyncTest). The fixtures are a still-available question,
// a haggle and a scam link.
public class ConversationsUiTest extends BaseUiTest {

  private static final int SANDBOX_THREADS = 3;
  private static final String HAGGLE_MESSAGE = "Would you take 50";
  private static final String SCAM_MESSAGE = "olx-dostawa.pl";
  private static final String EDITED_REPLY = "Thank you for your offer, please send me your best final offer.";
  private static final String LINK_WARNING = "Link outside OLX";

  @Test
  public void sellerEditsAndSendsDraft() {
    ProductListingPojo listing = signInWithSandboxConversations();
    productDetailPageSteps
        .openProductPage(listing)
        .editAndSendDraft(HAGGLE_MESSAGE, EDITED_REPLY)
        .verify()
        .conversationShowsSentReply(HAGGLE_MESSAGE, EDITED_REPLY);
  }

  @Test
  public void suspiciousThreadShowsWarningAndNoSend() {
    ProductListingPojo listing = signInWithSandboxConversations();
    productDetailPageSteps
        .openProductPage(listing)
        .verify()
        .conversationWarnsWithoutSend(SCAM_MESSAGE, LINK_WARNING);
  }

  private ProductListingPojo signInWithSandboxConversations() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo listing = listingSteps.publishSandboxOlxListing(account, ProductRequestPojo.conversationSample());
    marketplaceSteps.syncOlx(account);
    conversationSteps.awaitSettledThreads(account, listing.productId(), SANDBOX_THREADS);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    return listing;
  }
}
