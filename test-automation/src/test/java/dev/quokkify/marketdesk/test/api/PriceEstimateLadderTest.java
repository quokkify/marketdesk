package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

// The API stack has no Hermes and no research profile: the offline heuristic provider keeps the
// listing price as the start price with low confidence, and the market search reports not configured.
public class PriceEstimateLadderTest extends BaseTest {

  // Above the substitute ceiling, so the offline start price (the listing price) must be cut to it.
  private static final double PRODUCT_PRICE = 299.0;
  // 70 % of the median of the three cheapest new substitutes (280, 300, 320).
  private static final double SUBSTITUTE_CEILING = 210.0;
  private static final String LOW = "low";
  private static final String LOW_CONFIDENCE = "low_confidence";
  private static final String ACCESSORIES = "pilot";
  private static final String SUBSTITUTE_NEW = "substitute_new";

  @Test
  public void runStoresLastEstimate() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().hasLastEstimate(
        priceResearchSteps.getPriceResearch(account, productListing.productId()));
  }

  // Without the ceiling the stored start price would stay at the listing price, 299.
  @Test
  public void substituteCeilingCapsStartPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.saveClassCheckedComparables(account, productListing.productId(), SUBSTITUTE_NEW,
        280.0, 300.0, 320.0);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().lastEstimateStartsAt(
        priceResearchSteps.getPriceResearch(account, productListing.productId()), SUBSTITUTE_CEILING);
  }

  // Auto substitutes saved before the class check have no classChecked flag: they set no ceiling.
  @Test
  public void legacyUncheckedSubstitutesDoNotCapStartPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.saveAutoComparables(account, productListing.productId(), SUBSTITUTE_NEW,
        280.0, 300.0, 320.0);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().lastEstimateStartsAt(
        priceResearchSteps.getPriceResearch(account, productListing.productId()), PRODUCT_PRICE);
  }

  // No tier evidence caps the confidence at low, and a low estimate is kept but never proposed.
  @Test
  public void hiddenEstimateHasReason() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, PRODUCT_PRICE);
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().lastEstimateIsHidden(
        priceResearchSteps.getPriceResearch(account, productListing.productId()), LOW, LOW_CONFIDENCE);
  }

  // The offline provider does not echo reasoning, so the prompt carrying the accessories is checked in
  // Jest; here the field survives an analysis that stores an estimate.
  @Test
  public void estimateKeepsMissingAccessories() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account,
        ProductRequestPojo.withPriceFloor(PRODUCT_PRICE, null).withMissingAccessories(ACCESSORIES));
    priceResearchSteps.runProductAnalysis(account, productListing.productId());
    priceResearchSteps.verify().hasLastEstimate(
        priceResearchSteps.getPriceResearch(account, productListing.productId()));
    ValidatableResponse product = productSteps.getProduct(account, productListing.productId());
    productSteps.verify()
        .verifyResponseStatusCode(product, HttpStatus.SC_OK)
        .hasMissingAccessories(product, ACCESSORIES);
  }
}
