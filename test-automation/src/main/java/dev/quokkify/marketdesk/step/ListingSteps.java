package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.util.UUID;

import dev.quokkify.marketdesk.helper.DatabaseHelper;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.MarketplaceCategoryRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.model.RevivalRequestPojo;
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
  private final DatabaseHelper database = new DatabaseHelper();

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
    return createOlxProductListing(account, ProductRequestPojo.sample());
  }

  @Step("Create a product with a photo and an OLX listing that expired on OLX, keep both ids")
  public ProductListingPojo createExpiredOlxProductListing(AccountPojo account) {
    ProductListingPojo productListing = createOlxProductListing(account, ProductRequestPojo.sample().withPhoto());
    markExpiredOnOlx(productListing.listingId());
    return productListing;
  }

  @Step("Create a product without photos and an OLX listing that expired on OLX, keep both ids")
  public ProductListingPojo createExpiredOlxProductListingWithoutPhotos(AccountPojo account) {
    ProductListingPojo productListing = createOlxProductListing(account, ProductRequestPojo.sample());
    markExpiredOnOlx(productListing.listingId());
    return productListing;
  }

  @Step("Create a product with condition {condition} and an OLX listing that expired on OLX, keep both ids")
  public ProductListingPojo createExpiredOlxProductListingWithCondition(AccountPojo account, String condition) {
    ProductListingPojo productListing = createOlxProductListing(account,
        ProductRequestPojo.sample().withCondition(condition));
    markExpiredOnOlx(productListing.listingId());
    return productListing;
  }

  @Step("Create a product with condition {condition} and an OLX listing")
  public String createOlxListingWithCondition(AccountPojo account, String condition) {
    return createOlxProductListing(account, ProductRequestPojo.sample().withCondition(condition)).listingId();
  }

  @Step("Create a product with condition {condition}, no cost price and an OLX listing")
  public String createOlxListingWithoutCostPrice(AccountPojo account, String condition) {
    return createOlxProductListing(account, ProductRequestPojo.sample().withCondition(condition).withoutCostPrice())
        .listingId();
  }

  // The stub stack never expires an advert, so the listing is moved there in the database.
  @Step("Listing {listingId} expired on OLX")
  public void markExpiredOnOlx(String listingId) {
    database.markListingExpired(listingId, "qa-olx-" + UUID.randomUUID());
  }

  @Step("Create the given product with an OLX listing and keep both ids")
  public ProductListingPojo createOlxProductListing(AccountPojo account, ProductRequestPojo product) {
    String productId = productService.createProduct(account.token(), product)
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

  @Step("Set the price of listing {listingId} to {price}")
  public ValidatableResponse updatePrice(AccountPojo account, String listingId, double price) {
    return service.updatePrice(account.token(), listingId, price);
  }

  @Step("Get listing {listingId}")
  public ValidatableResponse getListing(AccountPojo account, String listingId) {
    return service.getListing(account.token(), listingId);
  }

  @Step("Reactivate listing {listingId} on OLX")
  public ValidatableResponse reactivate(AccountPojo account, String listingId) {
    return service.reactivate(account.token(), listingId);
  }

  @Step("Reactivate listing {listingId} without authentication")
  public ValidatableResponse reactivateUnauthenticated(String listingId) {
    return service.reactivate(listingId);
  }

  @Step("Publish listing {listingId} to OLX")
  public ValidatableResponse publish(AccountPojo account, String listingId) {
    return service.publish(account.token(), listingId);
  }

  @Step("Ask for a revival proposal for listing {listingId}")
  public ValidatableResponse requestRevivalProposal(AccountPojo account, String listingId) {
    return service.revivalProposal(account.token(), listingId);
  }

  @Step("Ask for a revival proposal for listing {listingId} without authentication")
  public ValidatableResponse requestRevivalProposalUnauthenticated(String listingId) {
    return service.revivalProposal(listingId);
  }

  // The proposal carries the timestamps an apply must quote to show it is not stale.
  @Step("Prepare a revival of listing {listingId} with condition {condition} from a fresh proposal")
  public RevivalRequestPojo freshRevival(AccountPojo account, String listingId, String condition) {
    ValidatableResponse proposal = service.revivalProposal(account.token(), listingId).statusCode(HttpStatus.SC_OK);
    return RevivalRequestPojo.of(condition, proposal.extract().path("data.productUpdatedAt"),
        proposal.extract().path("data.listingUpdatedAt"));
  }

  @Step("Revive listing {listingId} on OLX")
  public ValidatableResponse revive(AccountPojo account, String listingId, RevivalRequestPojo body) {
    return service.revive(account.token(), listingId, body);
  }

  @Step("Revive listing {listingId} without authentication")
  public ValidatableResponse reviveUnauthenticated(String listingId, RevivalRequestPojo body) {
    return service.revive(listingId, body);
  }
}
