package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

public class PublicationJourneyUiTest extends BaseUiTest {

  private static final String PRODUCT_NAME = ProductRequestPojo.sample().name();

  @Test
  public void creationEntryAndReviewOnlyAssistanceAreVisible() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    listingSteps.setSandboxOlxCategory(account, productListing.listingId());
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productsPageSteps
        .openNewProductDialog()
        .verify()
        .newProductDialogIsShown()
        .backToSteps()
        .closeNewProductDialog();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsPublicationReadinessCheck()
        .backToSteps()
        .suggestImprovements()
        .verify()
        .showsSuggestionsForReviewOnly(PRODUCT_NAME)
        .backToSteps()
        .openPublicationDialog()
        .verify()
        .showsPublicationConfirmation();
  }
}
