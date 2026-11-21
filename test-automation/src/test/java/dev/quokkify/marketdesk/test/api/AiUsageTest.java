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

  @Test
  public void usageCountsAnOfflineAnalysisToday() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    productSteps.proposeImprovements(account, productListing);
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, 1), 1);
  }

  @Test
  public void usageIsScopedToTheWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    productSteps.proposeImprovements(account, listingSteps.createOlxProductListing(account));
    AccountPojo other = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(other);
    productSteps.proposeImprovements(other, listingSteps.createOlxProductListing(other));
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, 1), 1);
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(other, 1), 1);
  }

  @Test
  public void usageRequiresLogin() {
    aiUsageSteps.verify().isUnauthenticated(aiUsageSteps.getUsageUnauthenticated());
  }
}
