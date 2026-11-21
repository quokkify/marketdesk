package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API test stack runs OLX in stub mode, so a reactivation must stop at the sandbox guard; the real OLX
// path is checked by hand on production.
public class ListingReactivationTest extends BaseTest {

  @Test
  public void rejectsUnauthenticatedReactivation() {
    listingSteps.verify().isUnauthenticated(listingSteps.reactivateUnauthenticated(UUID.randomUUID().toString()));
  }

  @Test
  public void reportsUnknownListingAsNotFound() {
    AccountPojo account = authSteps.registerNewAccount();
    listingSteps.verify().isNotFound(listingSteps.reactivate(account, UUID.randomUUID().toString()));
  }

  @Test
  public void refusesReactivationInSandboxMode() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListing(account);
    listingSteps.verify().isSandboxRefusal(listingSteps.reactivate(account, listingId));
  }
}
