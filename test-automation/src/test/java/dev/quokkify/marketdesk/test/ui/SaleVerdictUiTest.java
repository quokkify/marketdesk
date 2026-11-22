package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// The stand's research profile mock has no answers for the sample product, so its price research fails; the product
// has no photos and its OLX category is not an exact leaf, so its verdict is "Needs you" with a failing Photos check.
public class SaleVerdictUiTest extends BaseUiTest {

  private static final String PRODUCT_NAME = ProductRequestPojo.sample().name();
  private static final String NEEDS_YOU = "Needs you";
  private static final String ANALYZE_AGAIN = "Analyze again";
  private static final String CHANGED_SINCE_CHECK = "The product changed since this check.";
  private static final String PHOTOS = "photos";
  private static final String PHOTOS_MISSING = "Photos ✗";
  private static final String ACCESSORIES = "remote";

  @Test
  public void analyzeShowsVerdictInRow() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    listingSteps.createOlxProductListing(account);
    signIn(account);
    productsPageSteps
        .analyzeRow(PRODUCT_NAME)
        .verify()
        .rowShowsText(PRODUCT_NAME, NEEDS_YOU)
        .rowShowsVerdictCheck(PRODUCT_NAME, PHOTOS, PHOTOS_MISSING);
  }

  @Test
  public void checksTabShowsTheFailingPhotosCheck() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsHermesChip(NEEDS_YOU);
    productDetailPageSteps
        .openHermesRow(PHOTOS)
        .verify()
        .checksTabReads(PHOTOS, PHOTOS_MISSING);
  }

  @Test
  public void editMarksTheVerdictOutOfDate() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsHermesChip(NEEDS_YOU);
    productDetailPageSteps
        .saveMissingAccessories(ACCESSORIES)
        .verify()
        .showsHermesLead(CHANGED_SINCE_CHECK)
        .offersHermesPrimaryAction(ANALYZE_AGAIN);
  }

  private void signIn(AccountPojo account) {
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }
}
