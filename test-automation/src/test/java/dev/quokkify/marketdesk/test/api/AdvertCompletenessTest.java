package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceCategoryPojo;
import dev.quokkify.marketdesk.model.OlxAdvertPagePojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

// The category, attributes and delivery checks of the sale verdict on the stub OLX. Every stub advert starts with
// state "used" and the seller's brand "sandbox-seller-brand"; its category offers state, brand, type, bdo and
// delivery. Each MarketDesk write to the advert is a full-replace update, so a test that writes also checks that the
// seller's brand survived it. The advert page each test registers on the mock is the one at its listing's URL.
public class AdvertCompletenessTest extends BaseTest {

  private static final String CATEGORY = "category";
  private static final String ATTRIBUTES = "attributes";
  private static final String DELIVERY = "delivery";
  private static final String READY = "ready";
  private static final String FIX = "fix";
  private static final String NEEDS_HUMAN = "needs_human";
  private static final String BRAND = "brand";
  private static final String STILL_EMPTY = "attributes_still_empty";
  private static final String CATEGORY_FIRST = "category_first";
  private static final String FILLED = "filled_advert_attributes";
  private static final String APPLIED = "applied";
  private static final String FILLED_TYPE = "Filled Typ: nauszne (found in the title)";
  private static final String DELIVERY_ON = "BuyWithDelivery";
  private static final String DELIVERY_OFF = "NotEligible";
  private static final String SUGGESTED_DELIVERY = "suggested_delivery";
  private static final String PARCEL_SIZE = "M";
  private static final String PENDING_REVIEW = "pending_review";

  private ProductListingPojo liveAdvert(AccountPojo account, ProductRequestPojo product, String slug) {
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account, product);
    listingSteps.markLiveOnOlxWithPage(productListing.listingId(), slug, MarketplaceCategoryPojo.sandboxHeadphones());
    return productListing;
  }

  private AccountPojo accountWithSandbox() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    return account;
  }

  // The title holds "nauszne", the one value of the empty "type" attribute it names, so the check writes it. The
  // brand is already set on the advert, so the "Apple" in the title is left alone.
  @Test
  public void verifiableAttributeIsFilledOnce() {
    AccountPojo account = accountWithSandbox();
    String slug = OlxAdvertPagePojo.newSlug();
    hermesMockSteps.showAdvertPage(slug, DELIVERY_ON);
    String productId = liveAdvert(account, ProductRequestPojo.headphonesSample(), slug).productId();

    ValidatableResponse first = verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkStatusIs(first, CATEGORY, READY)
        .checkIsWithout(first, ATTRIBUTES, READY, STILL_EMPTY);
    ValidatableResponse events = verdictSteps.getProductEvents(account, productId);
    verdictSteps.verify()
        .hasEvents(events, FILLED, 1)
        .eventIs(events, FILLED, APPLIED, FILLED_TYPE)
        .noEventChangesAttribute(events, BRAND);

    ValidatableResponse second = verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkIsWithout(second, ATTRIBUTES, READY, STILL_EMPTY)
        .attributeIsNotMissing(second, BRAND);
    verdictSteps.verify().hasEvents(verdictSteps.getProductEvents(account, productId), FILLED, 1);
  }

  @Test
  public void categoryMismatchBlocksTheOtherChecks() {
    AccountPojo account = accountWithSandbox();
    String slug = OlxAdvertPagePojo.newSlug();
    hermesMockSteps.showAdvertPage(slug, DELIVERY_ON);
    String productId = liveAdvert(account, ProductRequestPojo.projectorAdvertSample(), slug).productId();

    ValidatableResponse view = verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkIs(view, CATEGORY, FIX, "category_mismatch")
        .checkIs(view, ATTRIBUTES, NEEDS_HUMAN, CATEGORY_FIRST)
        .checkIs(view, DELIVERY, NEEDS_HUMAN, CATEGORY_FIRST);
    ValidatableResponse events = verdictSteps.getProductEvents(account, productId);
    verdictSteps.verify()
        .hasEvents(events, "olx_category_mismatch", 1)
        .hasEvents(events, FILLED, 0);
  }

  @Test
  public void deliveryOffGetsSizeProposal() {
    AccountPojo account = accountWithSandbox();
    ProductRequestPojo product = ProductRequestPojo.headphonesSample();
    String slug = OlxAdvertPagePojo.newSlug();
    hermesMockSteps.showAdvertPage(slug, DELIVERY_OFF);
    hermesMockSteps.answerParcelSize(product.name(), PARCEL_SIZE);
    String productId = liveAdvert(account, product, slug).productId();

    verdictSteps.verify().checkIs(verdictSteps.analyzeAndAwait(account, productId), DELIVERY, FIX, "delivery_off");
    ValidatableResponse events = verdictSteps.getProductEvents(account, productId);
    verdictSteps.verify()
        .hasEvents(events, SUGGESTED_DELIVERY, 1)
        .eventIs(events, SUGGESTED_DELIVERY, PENDING_REVIEW, "Turn on Przesyłka OLX for parcel size M");

    verdictSteps.verify().isApplied(
        verdictSteps.approveEvent(account, verdictSteps.eventId(events, SUGGESTED_DELIVERY)));
    hermesMockSteps.switchAdvertPage(slug, DELIVERY_ON);
    ValidatableResponse after = verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkStatusIs(after, DELIVERY, READY)
        .attributeIsNotMissing(after, BRAND);
    verdictSteps.verify().noEventChangesAttribute(verdictSteps.getProductEvents(account, productId), BRAND);
  }

  @Test
  public void unreadablePageIsProbeFailed() {
    AccountPojo account = accountWithSandbox();
    String slug = OlxAdvertPagePojo.newSlug();
    hermesMockSteps.failAdvertPage(slug, HttpStatus.SC_INTERNAL_SERVER_ERROR);
    String productId = liveAdvert(account, ProductRequestPojo.headphonesSample(), slug).productId();

    ValidatableResponse view = verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .isCompletedWithChecks(view, "info", "price", "photos", CATEGORY, ATTRIBUTES, DELIVERY)
        .checkIs(view, DELIVERY, NEEDS_HUMAN, "probe_failed");
  }
}
