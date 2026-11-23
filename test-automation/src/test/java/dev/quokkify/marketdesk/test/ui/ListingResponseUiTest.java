package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.OlxSearchPagePojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// The listing is seeded as live for 72 hours with 10 views, so its stage is not_seen. The stand's MockServer proposes
// the product name as the buyer query and serves search pages with the advert as the 57th organic card of 966.
public class ListingResponseUiTest extends BaseUiTest {

  private static final int NOT_SEEN_HOURS = 72;
  private static final int FEW_VIEWS = 10;
  private static final String NOT_SEEN = "Not seen";
  private static final String POSITION_LINE = "Position 57 of 966";

  @Test
  public void whyNoResponseShowsTheSearchPosition() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductRequestPojo product = ProductRequestPojo.responseSample();
    String advertId = OlxSearchPagePojo.newAdvertId();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, product);
    listingSteps.markLiveOnOlx(productListing.listingId(), advertId, NOT_SEEN_HOURS, FEW_VIEWS);
    hermesMockSteps.answerSearchWithAdvertDeepInResults(product.name(), product.name(), advertId);
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();

    productsPageSteps
        .verify()
        .rowShowsText(product.name(), NOT_SEEN);
    productsPageSteps
        .askWhyNoResponse(product.name())
        .verify()
        .rowShowsText(product.name(), POSITION_LINE);
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsHermesResponse(POSITION_LINE);
  }
}
