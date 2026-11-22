package dev.quokkify.marketdesk.test.ui;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class PriceResearchUiTest extends BaseUiTest {

  private static final String SEARCH_NOT_CONFIGURED = "Market search is not configured";
  private static final String OLX_ADVERT = "https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html";
  private static final String OLX_ADVERT_2 = "https://www.olx.pl/d/oferta/airpods-4-CID99-ID1d1eUC.html";
  private static final String OLX_ADVERT_3 = "https://www.olx.pl/d/oferta/airpods-4-pro-CID99-ID1d1eUD.html";

  private static final String RETAIL_PRICE = "469.99";
  private static final String RETAIL_PRICE_SHOWN = "469,99 zł";
  private static final String MISSING_ACCESSORIES = "remote, charger";
  private static final String CLASS_LINE = "720p · 200 ANSI lm";
  private static final String CURRENCY = "PLN";
  private static final String SOURCE = "MediaMarkt";

  @Test
  public void retailAnchorIsSavedFromTheProductPage() {
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
        .saveRetailAnchor(RETAIL_PRICE, CURRENCY, SOURCE)
        .reloadPage()
        .verify()
        .showsRetailAnchor(RETAIL_PRICE, CURRENCY, SOURCE)
        .showsDiscountAgainstNew(RETAIL_PRICE_SHOWN, SOURCE);
  }

  // The stack has no research profile; the real search is checked by hand on production.
  @Test
  public void findPricesShowsNotConfigured() {
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
        .findPrices()
        .verify()
        .showsAlert(SEARCH_NOT_CONFIGURED);
  }

  @Test
  public void anchorsGroupedByTier() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    PriceResearchPojo research = PriceResearchPojo.sample().withComparables(List.of(
        new PriceResearchPojo.Comparable(280.0, "Phone A", OLX_ADVERT, "auto", "substitute_new", "2026-11-22"),
        new PriceResearchPojo.Comparable(300.0, "Phone B", OLX_ADVERT_2, "auto", "substitute_new", "2026-11-22"),
        new PriceResearchPojo.Comparable(320.0, "Phone C", OLX_ADVERT_3, "auto", "substitute_new", "2026-11-22")));
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productListing.productId(), research));
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsAnchorTier("same_model_used", "Same model, used", "not found")
        .showsAnchorTier("last_new_price", "Last new price", "not found")
        .showsAnchorTier("substitute_new", "New substitutes", "from 280 zł (3)")
        .showsAnchorTier("substitute_used", "Used substitutes", "not found");
  }

  @Test
  public void savedWebComparableShowsOlxLink() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productListing.productId(),
        PriceResearchPojo.sample().withComparable(
            new PriceResearchPojo.Comparable(250.0, "AirPods 4", OLX_ADVERT, "web"))));
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .reloadPage()
        .verify()
        .showsOlxLink(OLX_ADVERT);
  }

  @Test
  public void missingAccessoriesFieldSaves() {
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
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsClassLine(CLASS_LINE);
  }
}
