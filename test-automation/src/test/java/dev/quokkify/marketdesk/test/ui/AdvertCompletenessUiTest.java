package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceCategoryPojo;
import dev.quokkify.marketdesk.model.OlxAdvertPagePojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

// A live stub OLX advert in the category the stub suggests for its title, whose one empty choice attribute the title
// names, and whose page shows delivery off. The mock has no parcel size answer for it, so delivery stays a fix.
public class AdvertCompletenessUiTest extends BaseUiTest {

  private static final String INFO = "info";

  @Test
  public void checksTabShowsTheAdvertChecks() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String slug = OlxAdvertPagePojo.newSlug();
    hermesMockSteps.showAdvertPage(slug, "NotEligible");
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account,
        ProductRequestPojo.headphonesSample());
    listingSteps.markLiveOnOlxWithPage(productListing.listingId(), slug, MarketplaceCategoryPojo.sandboxHeadphones());
    verdictSteps.analyzeAndAwait(account, productListing.productId());

    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productDetailPageSteps.openProductPage(productListing);
    productDetailPageSteps
        .openHermesRow(INFO)
        .verify()
        .checksTabReads("category", "Category ✓")
        .checksTabReads("attributes", "Attributes ✓")
        .checksTabReads("delivery", "Delivery ✗");
  }
}
