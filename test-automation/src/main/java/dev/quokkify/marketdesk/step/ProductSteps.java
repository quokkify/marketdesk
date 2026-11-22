package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ImprovementRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.ProductVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;

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
