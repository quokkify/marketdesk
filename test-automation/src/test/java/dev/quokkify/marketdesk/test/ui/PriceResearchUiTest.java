package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class PriceResearchUiTest extends BaseUiTest {

  private static final String RETAIL_PRICE = "469.99";
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
        .showsRetailAnchor(RETAIL_PRICE, CURRENCY, SOURCE);
  }
}
