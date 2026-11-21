package dev.quokkify.marketdesk.step;

import java.time.Duration;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.MarketplaceCategoryRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.ListingService;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.ListingVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class ListingSteps extends ApiSteps<ListingVerification> {

  private static final String DATA_ID = "data.id";
  private static final String DATA_STATUS = "data.status";
  private static final String LIVE = "live";
  private static final Duration PUBLISH_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration POLL_INTERVAL = Duration.ofMillis(500);

  private final ListingService service = new ListingService();
  private final ProductService productService = new ProductService();

  public ListingSteps() {
    this.verification = new ListingVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Create a product with an OLX listing")
  public String createOlxListing(AccountPojo account) {
    return createOlxProductListing(account).listingId();
  }

  @Step("Create a product with an OLX listing and keep both ids")
  public ProductListingPojo createOlxProductListing(AccountPojo account) {
    String productId = productService.createProduct(account.token(), ProductRequestPojo.sample())
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path(DATA_ID);
    String listingId = productService.createListing(account.token(), productId, ListingRequestPojo.olx())
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path(DATA_ID);
    return new ProductListingPojo(productId, listingId);
  }

  // The stub adapter publishes to the sandbox advert store; its adverts carry the sandbox buyer threads.
  @Step("Publish a product to the sandbox OLX and wait until its listing is live")
  public ProductListingPojo publishSandboxOlxListing(AccountPojo account, ProductRequestPojo product) {
    String productId = productService.createProduct(account.token(), product)
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path(DATA_ID);
    String listingId = productService.createListing(account.token(), productId, ListingRequestPojo.olx())
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path(DATA_ID);
    service.setMarketplaceCategory(account.token(), listingId, MarketplaceCategoryRequestPojo.sandboxCameras())
        .statusCode(HttpStatus.SC_OK);
    service.publish(account.token(), listingId).statusCode(HttpStatus.SC_OK);
    Waiter.awaitCondition(
        () -> LIVE.equals(service.getListing(account.token(), listingId).extract().path(DATA_STATUS)),
        "the sandbox OLX listing is live", PUBLISH_TIMEOUT, POLL_INTERVAL);
    return new ProductListingPojo(productId, listingId);
  }

  @Step("Reactivate listing {listingId} on OLX")
  public ValidatableResponse reactivate(AccountPojo account, String listingId) {
    return service.reactivate(account.token(), listingId);
  }

  @Step("Reactivate listing {listingId} without authentication")
  public ValidatableResponse reactivateUnauthenticated(String listingId) {
    return service.reactivate(listingId);
  }
}
