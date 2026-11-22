package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

// The stand's research profile mock has no answers for the sample product, so its price research fails; the product
// has no photos and its OLX category is not an exact leaf, so its verdict is "Needs you" with a failing Photos check.
public class SaleVerdictUiTest extends BaseUiTest {

  private static final String PRODUCT_NAME = ProductRequestPojo.sample().name();
  private static final String NEEDS_YOU = "Needs you";
  private static final String OUT_OF_DATE = "Out of date";
  private static final String PHOTOS = "photos";
  private static final String INFO = "info";
  private static final String PRICE = "price";
  private static final String PHOTOS_MISSING = "Photos ✗";
  private static final String ACCESSORIES = "remote";

  @Test
  public void analyzeShowsVerdictInRow() {
    signInWithOneListedProduct();
    productsPageSteps
        .analyzeRow(PRODUCT_NAME)
        .verify()
        .rowShowsText(PRODUCT_NAME, NEEDS_YOU)
        .rowShowsVerdictCheck(PRODUCT_NAME, PHOTOS, PHOTOS_MISSING);
  }

  @Test
  public void reviewPriceRunsOnlyPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    String productId = productListing.productId();
    ValidatableResponse before = verdictSteps.analyzeAndAwait(account, productId);
    String infoBefore = verdictSteps.checkedAt(before, INFO);
    String priceBefore = verdictSteps.checkedAt(before, PRICE);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsVerdictText(NEEDS_YOU);
    productDetailPageSteps.reviewPrice();
    ValidatableResponse after = verdictSteps.awaitCheckLater(account, productId, PRICE, priceBefore);
    verdictSteps.verify().isUnchanged(infoBefore, verdictSteps.checkedAt(after, INFO));
    productDetailPageSteps
        .verify()
        .showsVerdictText(NEEDS_YOU)
        .showsVerdictCheck(PHOTOS, PHOTOS_MISSING);
  }

  @Test
  public void editMarksVerdictOutOfDate() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.analyzeAndAwait(account, productListing.productId());
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsVerdictText(NEEDS_YOU);
    productDetailPageSteps
        .saveMissingAccessories(ACCESSORIES)
        .verify()
        .showsVerdictText(OUT_OF_DATE);
  }

  private ProductListingPojo signInWithOneListedProduct() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    return productListing;
  }
}
