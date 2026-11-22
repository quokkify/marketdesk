package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API test stack has no main Hermes profile, so the verdict's listing SEO call runs on the offline heuristics;
// Hermes token counts are checked by hand on production. The verdict's price check also researches the price on
// the research profile mock, which has no answer for these products: identify is tried twice (IDENTIFY_ATTEMPTS
// in PriceResearchGraph.ts), and both refused attempts count as Hermes calls.
public class AiUsageTest extends BaseTest {

  private static final int OFFLINE = 1;
  private static final int REFUSED_RESEARCH = 2;
  private static final int ANALYSES = OFFLINE + REFUSED_RESEARCH;

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
  public void usageCountsTheOfflineSeoCallAndTheRefusedResearchToday() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductListingPojo productListing = listingWithSeoAgent(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    aiUsageSteps.verify().countsAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, ANALYSES), OFFLINE,
        REFUSED_RESEARCH);
  }

  @Test
  public void usageIsScopedToTheWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    verdictSteps.analyzeAndAwait(account, listingWithSeoAgent(account).productId());
    AccountPojo other = authSteps.registerNewAccount();
    verdictSteps.analyzeAndAwait(other, listingWithSeoAgent(other).productId());
    aiUsageSteps.verify().countsAnalysesToday(aiUsageSteps.getUsageOnceCounted(account, ANALYSES), OFFLINE,
        REFUSED_RESEARCH);
    aiUsageSteps.verify().countsAnalysesToday(aiUsageSteps.getUsageOnceCounted(other, ANALYSES), OFFLINE,
        REFUSED_RESEARCH);
  }

  @Test
  public void usageRequiresLogin() {
    aiUsageSteps.verify().isUnauthenticated(aiUsageSteps.getUsageUnauthenticated());
  }
}
