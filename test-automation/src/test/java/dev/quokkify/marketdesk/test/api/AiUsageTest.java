package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API test stack has no Hermes, so every analysis runs on the offline heuristics; Hermes token counts are
// checked by hand on production. The verdict's listing SEO call is the analysis the usage report counts.
public class AiUsageTest extends BaseTest {

  private ProductListingPojo listingWithSeoAgent(AccountPojo account) {
    marketplaceSteps.connectSandboxOlx(account);
    verdictSteps.enableListingSeo(account);
    return listingSteps.createOlxProductListing(account);
  }

  @Test
  public void revivalProposalReportsOfflineUsage() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    productSteps.verify().reportsOfflineAiUsage(listingSteps.requestRevivalProposal(account, listingId));
  }

  @Test
  public void usageCountsAnOfflineAnalysisToday() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductListingPojo productListing = listingWithSeoAgent(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, 1), 1);
  }

  @Test
  public void usageIsScopedToTheWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    verdictSteps.analyzeAndAwait(account, listingWithSeoAgent(account).productId());
    AccountPojo other = authSteps.registerNewAccount();
    verdictSteps.analyzeAndAwait(other, listingWithSeoAgent(other).productId());
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, 1), 1);
    aiUsageSteps.verify().countsOfflineAnalysesToday(aiUsageSteps.getUsageOnceCounted(other, 1), 1);
  }

  @Test
  public void usageRequiresLogin() {
    aiUsageSteps.verify().isUnauthenticated(aiUsageSteps.getUsageUnauthenticated());
  }
}
