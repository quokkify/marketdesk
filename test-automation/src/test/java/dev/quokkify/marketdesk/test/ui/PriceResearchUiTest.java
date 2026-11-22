package dev.quokkify.marketdesk.test.ui;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class PriceResearchUiTest extends BaseUiTest {

  private static final String SEARCH_UNAVAILABLE = "Price search failed: market search is unavailable";
  private static final String HERMES_UNAVAILABLE = "hermes_unavailable";
  private static final String OLX_ADVERT = "https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html";
  private static final String OLX_ADVERT_2 = "https://www.olx.pl/d/oferta/airpods-4-CID99-ID1d1eUC.html";
  private static final String OLX_ADVERT_3 = "https://www.olx.pl/d/oferta/airpods-4-pro-CID99-ID1d1eUD.html";

  private static final String PRICES_ROW = "prices";
  private static final String SAME_MODEL_USED = "same_model_used";
  private static final String SUBSTITUTE_NEW = "substitute_new";
  private static final String SUBSTITUTE_USED = "substitute_used";
  private static final String NONE_FOUND = "none found";
  private static final String RETAIL_PRICE_SHOWN = "469,99 zł";
  private static final String MISSING_ACCESSORIES = "remote, charger";
  private static final String CLASS_LINE = "720p · 200 ANSI lm";
  private static final String SOURCE = "MediaMarkt";

  @Test
  public void discountAgainstNewIsShownUnderThePrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.verify().isSaved(
        priceResearchSteps.savePriceResearch(account, productListing.productId(), PriceResearchPojo.sample()));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsDiscountAgainstNew(RETAIL_PRICE_SHOWN, SOURCE);
  }

  // The research profile mock has no answers for this product, so the search that Search again starts fails; the
  // real search is checked by hand on production.
  @Test
  public void searchAgainShowsAFailedSearch() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.verify().isSaved(priceResearchSteps.saveAutoComparables(
        account, productListing.productId(), SAME_MODEL_USED, 250.0));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .openHermesRow(PRICES_ROW)
        .searchPricesAgain()
        .verify()
        .priceSearchHasFinished()
        .showsLastPriceSearch(SEARCH_UNAVAILABLE);
    // The line is shared by several error codes; the run itself says the mock refused the call.
    priceResearchSteps.verify().lastRunFailed(
        priceResearchSteps.awaitResearchRun(account, productListing.productId()), HERMES_UNAVAILABLE);
  }

  @Test
  public void foundPricesAreGroupedByTier() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    PriceResearchPojo research = PriceResearchPojo.sample().withComparables(List.of(
        new PriceResearchPojo.Comparable(280.0, "Phone A", OLX_ADVERT, "auto", SUBSTITUTE_NEW, "2026-11-22"),
        new PriceResearchPojo.Comparable(300.0, "Phone B", OLX_ADVERT_2, "auto", SUBSTITUTE_NEW, "2026-11-22"),
        new PriceResearchPojo.Comparable(320.0, "Phone C", OLX_ADVERT_3, "auto", SUBSTITUTE_NEW, "2026-11-22")));
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productListing.productId(), research));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .openHermesRow(PRICES_ROW)
        .verify()
        .foundPricesInclude(SAME_MODEL_USED, NONE_FOUND)
        .foundPricesInclude(SUBSTITUTE_NEW, "280 zł")
        .foundPricesInclude(SUBSTITUTE_NEW, "300 zł")
        .foundPricesInclude(SUBSTITUTE_NEW, "320 zł")
        .foundPricesInclude(SUBSTITUTE_USED, NONE_FOUND);
  }

  @Test
  public void savedWebComparableLinksToItsAdvert() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productListing.productId(),
        PriceResearchPojo.sample().withComparable(
            new PriceResearchPojo.Comparable(250.0, "AirPods 4", OLX_ADVERT, "web"))));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .openHermesRow(PRICES_ROW)
        .verify()
        .foundPriceLinksTo(OLX_ADVERT);
  }

  @Test
  public void missingAccessoriesFieldSaves() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .saveMissingAccessories(MISSING_ACCESSORIES);
    productSteps.verify().hasMissingAccessories(
        productSteps.getProduct(account, productListing.productId()), MISSING_ACCESSORIES);
  }

  @Test
  public void substituteShowsClassLine() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.verify().isSaved(
        priceResearchSteps.saveClassCheckedSubstitute(account, productListing.productId()));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .openHermesRow(PRICES_ROW)
        .verify()
        .foundPricesInclude(SUBSTITUTE_USED, CLASS_LINE);
  }

  private void signIn(AccountPojo account) {
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }
}
