package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class ProductPriceFloorTest extends BaseTest {

  private static final String DATA_ID = "data.id";
  private static final double SELLING_PRICE = 100.0;
  private static final double FLOOR = 80.0;

  @Test
  public void storesAndReturnsMinAcceptablePrice() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse created = productSteps.createProduct(account,
        ProductRequestPojo.withPriceFloor(SELLING_PRICE, FLOOR));
    productSteps.verify().verifyResponseStatusCode(created, HttpStatus.SC_CREATED);
    String productId = created.extract().path(DATA_ID);

    ValidatableResponse response = productSteps.getProduct(account, productId);
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasMinAcceptablePrice(response, FLOOR);
  }

  @Test
  public void rejectsFloorAboveSellingPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = productSteps.createProduct(account,
        ProductRequestPojo.withPriceFloor(SELLING_PRICE, 120.0));
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_UNPROCESSABLE_ENTITY)
        .hasFailed(response);
  }

  @Test
  public void rejectsNegativeFloor() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = productSteps.createProduct(account,
        ProductRequestPojo.withPriceFloor(SELLING_PRICE, -1.0));
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_UNPROCESSABLE_ENTITY)
        .hasFailed(response);
  }

  @Test
  public void nullFloorByDefault() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse created = productSteps.createProduct(account,
        ProductRequestPojo.withPriceFloor(SELLING_PRICE, null));
    productSteps.verify().verifyResponseStatusCode(created, HttpStatus.SC_CREATED);
    String productId = created.extract().path(DATA_ID);

    ValidatableResponse response = productSteps.getProduct(account, productId);
    productSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasNoMinAcceptablePrice(response);
  }
}
