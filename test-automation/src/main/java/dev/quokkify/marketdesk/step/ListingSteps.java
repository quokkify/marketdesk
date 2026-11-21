package dev.quokkify.marketdesk.step;

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

  @Step("Reactivate listing {listingId} on OLX")
  public ValidatableResponse reactivate(AccountPojo account, String listingId) {
    return service.reactivate(account.token(), listingId);
  }

  @Step("Reactivate listing {listingId} without authentication")
  public ValidatableResponse reactivateUnauthenticated(String listingId) {
    return service.reactivate(listingId);
  }
}
