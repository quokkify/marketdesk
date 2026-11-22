package dev.quokkify.marketdesk.test.ui;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// The stand answers with offline heuristics; for the sample product ("good" condition, no condition
// in its name) they always propose one title change, so each analysis yields exactly one suggestion.
public class ProductsCatalogueUiTest extends BaseUiTest {

  private static final String PRODUCT_NAME = ProductRequestPojo.sample().name();
  private static final int FILTERS_GAP_PX = 16;
  private static final String ACTIVE_TAB = "Active";

  @Test
  public void catalogueShowsOnlyUsefulColumns() {
    signInWithOneListedProduct();
    productsPageSteps
        .verify()
        .hasColumns(List.of("Product", "Status", "Price", "Updated", "AI"))
        .lacksColumns(List.of("Markets", "Cost", "Profit", "Tags"));
  }

  // Regression guard: the panel used to sit flush against the table (Card height:100% inside Collapse).
  @Test
  public void filtersPanelKeepsItsDistanceFromTheTable() {
    signInWithOneListedProduct();
    productsPageSteps
        .openFilters()
        .verify()
        .filtersPanelGapAtLeast(FILTERS_GAP_PX);
  }

  @Test
  public void analyzeFromTheRowStaysOnTheCatalogue() {
    signInWithOneListedProduct();
    productsPageSteps
        .analyzeRow(PRODUCT_NAME)
        .verify()
        .rowShowsAnalysisResult(PRODUCT_NAME)
        .isOnProductsPage();
  }

  // Regression guard: clicks in the portaled row menu bubbled to the row and opened the product.
  @Test
  public void analyzeFromTheRowMenuStaysOnTheCatalogue() {
    signInWithOneListedProduct();
    productsPageSteps
        .analyzeFromRowMenu(PRODUCT_NAME)
        .verify()
        .rowShowsAnalysisResult(PRODUCT_NAME)
        .isOnProductsPage();
  }

  @Test
  public void clickingTheRowOpensTheProduct() {
    ProductListingPojo productListing = signInWithOneListedProduct();
    productsPageSteps
        .clickRow(PRODUCT_NAME)
        .verify()
        .isOnProductPage(productListing.productId());
  }

  @Test
  public void suggestionIsApprovedInPlaceOnTheActiveTab() {
    signInWithOneListedProduct();
    productsPageSteps
        .openTab(ACTIVE_TAB)
        .analyzeRow(PRODUCT_NAME)
        .verify()
        .reviewExpandedUnder(PRODUCT_NAME)
        .isOnProductsPage()
        .activeTabSelected();
    productsPageSteps
        .approveFirstSuggestion(PRODUCT_NAME)
        .verify()
        .rowShowsAllReviewed(PRODUCT_NAME)
        .isOnProductsPage()
        .activeTabSelected();
  }

  @Test
  public void suggestionIsDismissedInPlace() {
    signInWithOneListedProduct();
    productsPageSteps
        .analyzeRow(PRODUCT_NAME)
        .verify()
        .reviewExpandedUnder(PRODUCT_NAME);
    productsPageSteps
        .dismissFirstSuggestion(PRODUCT_NAME)
        .verify()
        .rowShowsAllReviewed(PRODUCT_NAME)
        .isOnProductsPage();
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
