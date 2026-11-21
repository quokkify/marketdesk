package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The proposal touches no marketplace, so it runs in the sandbox; the expired advert is seeded in the database.
public class RevivalTest extends BaseTest {

  @Test
  public void proposalListsMissingConditionForAnExpiredListing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListingWithoutCostPrice(account, "unknown");
    listingSteps.markExpiredOnOlx(listingId);
    listingSteps.verify()
        .isProposalWithMissingConditionAndCostPrice(listingSteps.requestRevivalProposal(account, listingId));
  }

  @Test
  public void proposalRefusesALiveOrDraftListing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListing(account);
    listingSteps.verify().isRevivalRefusal(listingSteps.requestRevivalProposal(account, listingId));
  }

  @Test
  public void proposalHidesAnotherWorkspaceListing() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    String listingId = listingSteps.createOlxListing(owner);
    listingSteps.markExpiredOnOlx(listingId);
    AccountPojo stranger = authSteps.registerNewAccount();
    listingSteps.verify().isNotFound(listingSteps.requestRevivalProposal(stranger, listingId));
  }

  @Test
  public void proposalRequiresLogin() {
    listingSteps.verify()
        .isUnauthenticated(listingSteps.requestRevivalProposalUnauthenticated(UUID.randomUUID().toString()));
  }
}
