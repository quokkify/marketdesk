package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;

import org.testng.annotations.Test;

public class PriceFieldWheelUiTest extends BaseUiTest {

  private static final String TYPED_PRICE = "279";

  // Regression guard: a wheel over the focused number input used to change the price by 0.01 per tick,
  // so a typed 279 was saved as 278.84 and sent to OLX.
  @Test
  public void wheelOverFocusedSellingPriceKeepsTypedValue() {
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
        .openEditForm()
        .typeSellingPriceAndScrollOverIt(TYPED_PRICE);
    productDetailPageSteps
        .verify()
        .sellingPriceIs(TYPED_PRICE);
    productDetailPageSteps
        .saveChanges()
        .openEditForm()
        .verify()
        .sellingPriceIs(TYPED_PRICE);
  }
}
