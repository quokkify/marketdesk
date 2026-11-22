package dev.quokkify.marketdesk.step;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ImprovementRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.ProductVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class ProductSteps extends ApiSteps<ProductVerification> {

  private final ProductService service = new ProductService();

  public ProductSteps() {
    this.verification = new ProductVerification();
  }

  @Step("Get products without authentication")
  public ValidatableResponse getProductsUnauthenticated() {
    return service.getProducts();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Get products as an authenticated user")
  public ValidatableResponse getProducts(AccountPojo account) {
    return service.getProducts(account.token());
  }

  // The product is looked up by name because the wizard creates it through the UI.
  @Step("Find the product named {name} and its listing")
  public ProductListingPojo findProductListing(AccountPojo account, String name) {
    List<String> ids = service.getProducts(account.token())
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .jsonPath()
        .getList("data.findAll { it.name == '%s' }.id".formatted(name), String.class);
    String productId = ids.getFirst();
    String listingId = service.getListings(account.token(), productId)
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .path("data[0].id");
    return new ProductListingPojo(productId, listingId);
  }

  @Step("Get product statistics")
  public ValidatableResponse getProductStats(AccountPojo account) {
    return service.getProductStats(account.token());
  }

  @Step("Get product statistics without authentication")
  public ValidatableResponse getProductStatsUnauthenticated() {
    return service.getProductStats();
  }

  @Step("List products that need action")
  public ValidatableResponse getNeedsActionProducts(AccountPojo account) {
    return service.getNeedsActionProducts(account.token());
  }

  @Step("Set the status of product {productId} to {status}")
  public ValidatableResponse updateStatus(AccountPojo account, String productId, String status) {
    return service.updateStatus(account.token(), productId, status);
  }

  @Step("Analyze product {productId} with AI")
  public List<String> runHermes(AccountPojo account, String productId) {
    // The run answers synchronously but with 202 Accepted, carrying the created suggestions.
    return service.runHermes(account.token(), productId)
        .statusCode(HttpStatus.SC_ACCEPTED)
        .extract()
        .jsonPath()
        .getList("data.id", String.class);
  }

  @Step("Get pending AI suggestion counts")
  public ValidatableResponse getPendingCounts(AccountPojo account) {
    return service.getPendingCounts(account.token());
  }

  @Step("Get pending AI suggestion counts without authentication")
  public ValidatableResponse getPendingCountsUnauthenticated() {
    return service.getPendingCounts();
  }

  @Step("Dismiss AI suggestion {eventId}")
  public ValidatableResponse dismissEvent(AccountPojo account, String eventId) {
    return service.dismissEvent(account.token(), eventId);
  }

  @Step("Create a product")
  public ValidatableResponse createProduct(AccountPojo account, ProductRequestPojo product) {
    return service.createProduct(account.token(), product);
  }

  @Step("Get product {productId}")
  public ValidatableResponse getProduct(AccountPojo account, String productId) {
    return service.getProduct(account.token(), productId);
  }

  @Step("Set the lowest acceptable price of product {productId} to {minAcceptablePrice}")
  public ValidatableResponse updateMinAcceptablePrice(AccountPojo account, String productId,
      Double minAcceptablePrice) {
    return service.updateMinAcceptablePrice(account.token(), productId, minAcceptablePrice);
  }

  @Step("Set the selling price of product {productId} to {sellingPrice}")
  public ValidatableResponse updateSellingPrice(AccountPojo account, String productId, double sellingPrice) {
    return service.updateSellingPrice(account.token(), productId, sellingPrice);
  }

  @Step("Set the selling price of product {productId} to {sellingPrice} and its lowest acceptable price to {floor}")
  public ValidatableResponse updateSellingPriceAndFloor(AccountPojo account, String productId, double sellingPrice,
      double floor) {
    return service.updateSellingPriceAndFloor(account.token(), productId, sellingPrice, floor);
  }

  @Step("Rename product {productId} to {name}")
  public ValidatableResponse updateName(AccountPojo account, String productId, String name) {
    return service.updateName(account.token(), productId, name);
  }

  @Step("Ask for improvements of the product and its listing")
  public ValidatableResponse proposeImprovements(AccountPojo account, ProductListingPojo productListing) {
    return service.proposeImprovements(account.token(), productListing.productId(),
        new ImprovementRequestPojo(productListing.listingId()));
  }
}
