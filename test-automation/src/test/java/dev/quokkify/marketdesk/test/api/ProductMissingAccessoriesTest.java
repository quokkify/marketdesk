package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class ProductMissingAccessoriesTest extends BaseTest {

  private static final String DATA_ID = "data.id";
  private static final String ACCESSORIES = "pilot";
  private static final int MAX_LENGTH = 200;

  @Test
  public void productStoresMissingAccessories() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse created = productSteps.createProduct(account,
        ProductRequestPojo.sample().withMissingAccessories(ACCESSORIES));
    productSteps.verify().verifyResponseStatusCode(created, HttpStatus.SC_CREATED);
    String productId = created.extract().path(DATA_ID);

    ValidatableResponse response = productSteps.getProduct(account, productId);
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasMissingAccessories(response, ACCESSORIES);
  }

  @Test
  public void missingAccessoriesTooLongIs400() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = productSteps.createProduct(account,
        ProductRequestPojo.sample().withMissingAccessories("x".repeat(MAX_LENGTH + 1)));
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_BAD_REQUEST)
        .hasFailed(response);
  }
}
