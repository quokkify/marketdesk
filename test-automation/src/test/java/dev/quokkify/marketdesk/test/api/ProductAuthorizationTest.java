package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

public class ProductAuthorizationTest extends BaseTest {

  @Test(groups = "api")
  public void rejectsUnauthenticatedProductListing() {
    ValidatableResponse response = productSteps.getProductsUnauthenticated();
    productSteps.verify()
        .verifyResponseStatusCode(response, 401)
        .hasFailed(response)
        .hasErrorCode(response, "UNAUTHORIZED");
  }
}
