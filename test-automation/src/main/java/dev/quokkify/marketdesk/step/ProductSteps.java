package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ImprovementRequestPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
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

  @Step("Ask for improvements of the product and its listing")
  public ValidatableResponse proposeImprovements(AccountPojo account, ProductListingPojo productListing) {
    return service.proposeImprovements(account.token(), productListing.productId(),
        new ImprovementRequestPojo(productListing.listingId()));
  }
}
