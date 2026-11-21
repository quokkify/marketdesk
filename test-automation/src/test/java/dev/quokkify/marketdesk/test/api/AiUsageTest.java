package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API test stack has no Hermes, so every analysis runs on the offline heuristics; Hermes token counts are
// checked by hand on production.
public class AiUsageTest extends BaseTest {

  @Test
  public void improvementReportsOfflineUsage() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    productSteps.verify().reportsOfflineAiUsage(productSteps.proposeImprovements(account, productListing));
  }
}
