package dev.quokkify.marketdesk.test.ui;

import java.time.Duration;

import dev.quokkify.annotation.Sequential;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class AiUsageUiTest extends BaseUiTest {

  // The offline listing SEO call, and the identify attempts the research profile mock refuses for this product:
  // two, from IDENTIFY_ATTEMPTS in PriceResearchGraph.ts.
  private static final int ANALYSES_TODAY = 3;

  // Writes the one limits file the app container reads, so it runs alone.
  @Sequential
  @Test
  public void hermesActivityShowsLimitsAndUsage() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.enableListingSeo(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    aiUsageSteps.getUsageOnceCounted(account, ANALYSES_TODAY);
    hermesLimitsSteps.writeLimitsFetchedAgo(Duration.ZERO);
    hermesLimitsSteps.getLimitsOnceReported(account, "fresh");
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    hermesActivityPageSteps
        .openHermesActivityPage()
        .verify()
        .limitsCardShowsPlanAndWindows()
        .usageCardCountsAnalysesToday(ANALYSES_TODAY);
  }

  @Test
  public void revivalDialogShowsOfflineUsageLine() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createExpiredOlxProductListing(account);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .openRevivalDialog()
        .verify()
        .showsOfflineUsageLine();
  }
}
