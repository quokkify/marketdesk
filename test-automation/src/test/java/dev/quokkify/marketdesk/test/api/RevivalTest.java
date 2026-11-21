package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.RevivalRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The proposal touches no marketplace, so it runs in the sandbox; the expired advert is seeded in the database.
// The stack runs OLX in stub mode, so an apply stops at its refusals; the real OLX path is checked on production.
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

  @Test
  public void reviveRefusesUnknownCondition() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    RevivalRequestPojo revival = listingSteps.freshRevival(account, listingId, "unknown");
    listingSteps.verify().isConditionRefusal(listingSteps.revive(account, listingId, revival));
  }

  @Test
  public void reviveRefusesStaleTimestamps() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    RevivalRequestPojo revival = listingSteps.freshRevival(account, listingId, "good").withProductChangedLongAgo();
    listingSteps.verify().isStaleRevivalRefusal(listingSteps.revive(account, listingId, revival));
  }

  @Test
  public void reviveRefusesInSandbox() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    RevivalRequestPojo revival = listingSteps.freshRevival(account, listingId, "good");
    listingSteps.verify().isRevivalSandboxRefusal(listingSteps.revive(account, listingId, revival));
  }

  // The sample product is "good" with cost price 50; the refused apply must leave both untouched.
  @Test
  public void reviveRefusesBelowCostWithoutConfirmation() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createExpiredOlxProductListing(account);
    RevivalRequestPojo revival = listingSteps.freshRevival(account, productListing.listingId(), "new")
        .withPrices(100.0, 50.0);
    listingSteps.verify().isBelowCostRefusal(listingSteps.revive(account, productListing.listingId(), revival));
    productSteps.verify()
        .hasConditionAndCostPrice(productSteps.getProduct(account, productListing.productId()), "good", 50);
  }

  // The sample listing sells at 120; a cost price of 150 without a new price puts the advert below cost.
  @Test
  public void reviveRefusesACostPriceAboveTheAdvertPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createExpiredOlxProductListing(account);
    RevivalRequestPojo revival = listingSteps.freshRevival(account, productListing.listingId(), "new")
        .withPrices(150.0, null);
    listingSteps.verify().isBelowCostRefusal(listingSteps.revive(account, productListing.listingId(), revival));
    productSteps.verify()
        .hasConditionAndCostPrice(productSteps.getProduct(account, productListing.productId()), "good", 50);
  }

  @Test
  public void reviveRefusesADescriptionShorterThanTheProductAllows() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    RevivalRequestPojo revival = listingSteps.freshRevival(account, listingId, "good")
        .withDescription("Nineteen characters");
    listingSteps.verify().isFieldValidationRefusal(listingSteps.revive(account, listingId, revival), "description");
  }

  @Test
  public void reviveHidesAnotherWorkspaceListing() {
    AccountPojo owner = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(owner);
    String listingId = listingSteps.createExpiredOlxProductListing(owner).listingId();
    RevivalRequestPojo revival = listingSteps.freshRevival(owner, listingId, "good");
    AccountPojo stranger = authSteps.registerNewAccount();
    listingSteps.verify().isNotFound(listingSteps.revive(stranger, listingId, revival));
  }

  @Test
  public void reviveRequiresLogin() {
    listingSteps.verify().isUnauthenticated(
        listingSteps.reviveUnauthenticated(UUID.randomUUID().toString(), RevivalRequestPojo.longAgo("good")));
  }
}
