package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

// The stub stack runs OLX as a sandbox, which cannot revive an advert, so the revival dialog is not reachable here.
// The stub stack never expires an advert either, so the listing is moved there in the database.
public class RevivalUiTest extends BaseUiTest {

  @Test
  public void productPageKeepsRelistForAnExpiredSandboxAdvert() {
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
        .verify()
        .offersRelistNotRevive();
  }
}
