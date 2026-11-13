package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class ProductAuthorizationTest extends BaseTest {

  @Test
  public void rejectsUnauthenticatedProductListing() {
    ValidatableResponse response = productSteps.getProductsUnauthenticated();
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_UNAUTHORIZED)
        .hasFailed(response)
        .hasErrorCode(response, "UNAUTHORIZED");
  }

  @Test
  public void listsNoProductsForNewWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = productSteps.getProducts(account.token());
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasNoProducts(response);
  }
}
