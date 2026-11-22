package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API stack has no research profile and Hermes may answer from the offline heuristic provider.
public class PriceEstimateLadderTest extends BaseTest {

  private static final double PRODUCT_PRICE = 299.0;
  // 70 % of the median of the three cheapest new substitutes (280, 300, 320).
  private static final double SUBSTITUTE_CEILING = 210.0;

  @Test
  public void runStoresLastEstimate() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().hasLastEstimate(
        priceResearchSteps.getPriceResearch(account, productListing.productId()));
  }

  @Test
  public void substituteCeilingCapsStartPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.saveAutoComparables(account, productListing.productId(), "substitute_new",
        280.0, 300.0, 320.0);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().lastEstimateStartsAtMost(
        priceResearchSteps.getPriceResearch(account, productListing.productId()), SUBSTITUTE_CEILING);
  }

  @Test
  public void hiddenEstimateHasReason() {
    AccountPojo account = authSteps.registerNewAccount();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().lastEstimateHasHiddenReason(
        priceResearchSteps.getPriceResearch(account, productListing.productId()));
  }
}
