package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class PriceResearchUiTest extends BaseUiTest {

  private static final String SEARCH_NOT_CONFIGURED = "Market search is not configured";
  private static final String OLX_ADVERT = "https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html";

  private static final String RETAIL_PRICE = "469.99";
  private static final String RETAIL_PRICE_SHOWN = "469,99 zł";
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
  public void findComparablesShowsNotConfigured() {
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
        .findComparablesOnOlx()
        .verify()
        .showsAlert(SEARCH_NOT_CONFIGURED);
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
}
