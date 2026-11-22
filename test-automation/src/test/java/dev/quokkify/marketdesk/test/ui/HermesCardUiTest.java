package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// The Hermes card in the right rail of the product page and the drawer behind it. The stand's research profile mock
// answers only the products a test registers answers for, so the other products' price searches fail.
public class HermesCardUiTest extends BaseUiTest {

  private static final String NOT_ANALYSED = "Not analysed";
  private static final String NEEDS_YOU = "Needs you";
  private static final String ANALYZE_PRODUCT = "Analyze product";
  private static final String ANALYZE_AGAIN = "Analyze again";
  private static final String PRICES = "prices";
  private static final String CHECKS = "checks";
  private static final String SUGGESTIONS = "suggestions";
  private static final String HISTORY = "history";
  private static final String PRICE_CHECK = "Price check";
  private static final String SAME_MODEL_USED = "same_model_used";
  private static final String IDENTIFY = "identify";
  private static final String FOUND_PRICE = "289";
  private static final String MY_PRICE = "301";
  private static final double SEEDED_PRICE_AMOUNT = 290.0;

  @Test
  public void newProductOffersAnalyze() {
    ProductListingPojo productListing = signInWithOneListedProduct().listing();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsHermesChip(NOT_ANALYSED)
        .offersHermesPrimaryAction(ANALYZE_PRODUCT);
  }

  @Test
  public void analyzeFromTheCardShowsTheVerdict() {
    Session session = signInWithOneListedProduct();
    productDetailPageSteps
        .openProductPage(session.listing())
        .analyzeFromTheCard();
    verdictSteps.awaitVerdict(session.account(), session.listing().productId());
    productDetailPageSteps
        .verify()
        .showsHermesChip(NEEDS_YOU)
        .offersHermesPrimaryAction(ANALYZE_AGAIN);
  }

  @Test
  public void rowsOpenTheirTabs() {
    ProductListingPojo productListing = signInWithOneListedProduct().listing();
    productDetailPageSteps.openProductPage(productListing);
    String[][] rowsAndTabs = {
        {PRICES, PRICES}, {"price", CHECKS}, {"info", CHECKS}, {"photos", CHECKS}, {SUGGESTIONS, SUGGESTIONS}};
    for (String[] rowAndTab : rowsAndTabs) {
      productDetailPageSteps
          .openHermesRow(rowAndTab[0])
          .verify()
          .hermesDrawerIsOnTab(rowAndTab[1]);
      productDetailPageSteps.closeHermesDrawerWithEscape();
    }
    productDetailPageSteps
        .openLogAndHistory()
        .verify()
        .hermesDrawerIsOnTab(HISTORY);
  }

  // The seller's own price is kept when Hermes searches again: the mock answers every tier of the product, the run
  // replaces the found prices and the added one has to stay.
  @Test
  public void ownPriceSurvivesSearchAgain() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductRequestPojo product = ProductRequestPojo.researchSample();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, product);
    String productId = productListing.productId();
    hermesMockSteps.answerIdentify(product.name());
    hermesMockSteps.answerAllTiers(product.name());
    priceResearchSteps.verify().isSaved(
        priceResearchSteps.saveAutoComparables(account, productId, SAME_MODEL_USED, SEEDED_PRICE_AMOUNT));
    signIn(account);
    productDetailPageSteps
        .openProductPage(productListing)
        .openHermesRow(PRICES)
        .addMyPrice(MY_PRICE)
        .verify()
        .myPricesInclude(MY_PRICE);
    productDetailPageSteps
        .searchPricesAgain()
        .verify()
        .priceSearchHasFinished();
    hermesMockSteps.verify().receivedExpectedCalls(hermesMockSteps.checkCalls(product.name(), IDENTIFY, 1));
    productDetailPageSteps
        .verify()
        .foundPricesInclude(SAME_MODEL_USED, FOUND_PRICE)
        .myPricesInclude(MY_PRICE);
  }

  @Test
  public void historyListsTheAnalysis() {
    Session session = signInWithOneListedProduct();
    productDetailPageSteps
        .openProductPage(session.listing())
        .analyzeFromTheCard();
    verdictSteps.awaitVerdict(session.account(), session.listing().productId());
    productDetailPageSteps
        .openLogAndHistory()
        .verify()
        .historyHasStep(PRICE_CHECK);
  }

  @Test
  public void railHasNoOldCards() {
    ProductListingPojo productListing = signInWithOneListedProduct().listing();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsNoOldCards();
  }

  private Session signInWithOneListedProduct() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    signIn(account);
    return new Session(account, productListing);
  }

  private void signIn(AccountPojo account) {
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }

  private record Session(AccountPojo account, ProductListingPojo listing) {
  }
}
