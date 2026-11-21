package dev.quokkify.marketdesk.test.ui;

import java.time.Duration;

import dev.quokkify.annotation.Sequential;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class AiUsageUiTest extends BaseUiTest {

  // Writes the one limits file the app container reads, so it runs alone.
  @Sequential
  @Test
  public void hermesActivityShowsLimitsAndUsage() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    productSteps.proposeImprovements(account, productListing);
    aiUsageSteps.getUsageOnceCounted(account, 1);
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
        .usageCardCountsAnalysesToday(1);
  }

  @Test
  public void productPageShowsOfflineUsageLine() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .suggestImprovements()
        .verify()
        .showsOfflineUsageLine();
  }
}
