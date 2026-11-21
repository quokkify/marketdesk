package dev.quokkify.marketdesk.step;

import java.util.UUID;

import dev.quokkify.marketdesk.helper.DatabaseHelper;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ListingRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.ListingService;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.ListingVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class ListingSteps extends ApiSteps<ListingVerification> {

  private static final String DATA_ID = "data.id";

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

  private ProductListingPojo createOlxProductListing(AccountPojo account, ProductRequestPojo product) {
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
}
