package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

// The stub stack never expires an advert, so the listing is moved there in the database. The apply button is never
// clicked: the stub stack runs OLX as a sandbox, where the apply is refused, and nothing may reach OLX.
public class RevivalUiTest extends BaseUiTest {

  @Test
  public void productPageOffersReviveForAnExpiredAdvert() {
    ProductListingPojo productListing = signInWithExpiredAdvert();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .offersReviveAndRelist();
  }

  @Test
  public void reviveDialogNeedsACondition() {
    ProductListingPojo productListing = signInWithExpiredAdvert();
    productDetailPageSteps
        .openProductPage(productListing)
        .openRevivalDialog()
        .verify()
        .revivalNeedsACondition();
    productDetailPageSteps
        .openRevivalConditions()
        .verify()
        .revivalConditionsOmitUnknown();
    productDetailPageSteps
        .chooseRevivalCondition("Good")
        .verify()
        .revivalCanBeApplied();
  }

  private ProductListingPojo signInWithExpiredAdvert() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createExpiredOlxProductListingWithCondition(account, "unknown");
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    return productListing;
  }
}
