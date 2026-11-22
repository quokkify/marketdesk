package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

// A manual price change reaches OLX the way a Hermes approval does. The stub stack publishes to the sandbox
// advert store, which is enough to make a listing live; the real OLX path is checked by hand on production.
public class ManualPriceSyncTest extends BaseTest {

  private static final double NEW_PRICE = 90.0;
  private static final double CURRENT_PRICE = 100.0;
  private static final double FLOOR = 80.0;
  private static final double BELOW_FLOOR = 70.0;
  private static final double LOWERED_FLOOR = 60.0;
  private static final String NEW_NAME = "QA renamed camera";

  @Test
  public void livePriceChangeQueuesOlxUpdate() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo live = listingSteps.publishSandboxOlxListing(account, ProductRequestPojo.conversationSample());

    ValidatableResponse response = listingSteps.updatePrice(account, live.listingId(), NEW_PRICE);
    listingSteps.verify().queuedOlxUpdates(response, 1).hasPrice(response, NEW_PRICE);

    ValidatableResponse product = productSteps.getProduct(account, live.productId());
    productSteps.verify().verifyResponseStatusCode(product, HttpStatus.SC_OK).hasSellingPrice(product, NEW_PRICE);
  }

  @Test
  public void editPriceMovesListingAndQueues() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo live = listingSteps.publishSandboxOlxListing(account, ProductRequestPojo.conversationSample());

    ValidatableResponse response = productSteps.updateSellingPrice(account, live.productId(), NEW_PRICE);
    productSteps.verify().queuedOlxUpdates(response, 1).hasSellingPrice(response, NEW_PRICE);

    ValidatableResponse listing = listingSteps.getListing(account, live.listingId());
    listingSteps.verify().verifyResponseStatusCode(listing, HttpStatus.SC_OK).hasPrice(listing, NEW_PRICE);
  }

  @Test
  public void samePriceQueuesNothing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo live = listingSteps.publishSandboxOlxListing(account, ProductRequestPojo.conversationSample());

    ValidatableResponse response = listingSteps.updatePrice(account, live.listingId(), CURRENT_PRICE);
    listingSteps.verify().priceUnchanged(response);
  }

  @Test
  public void editWithoutPriceChangeQueuesNothing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo live = listingSteps.publishSandboxOlxListing(account, ProductRequestPojo.conversationSample());

    ValidatableResponse response = productSteps.updateName(account, live.productId(), NEW_NAME);
    productSteps.verify().hasNoPriceSync(response);
  }

  @Test
  public void draftListingPriceChangeQueuesNothing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String draftId = listingSteps.createOlxListing(account);

    ValidatableResponse response = listingSteps.updatePrice(account, draftId, NEW_PRICE);
    listingSteps.verify().queuedOlxUpdates(response, 0).hasPrice(response, NEW_PRICE);
  }

  @Test
  public void editBelowMinimumIsRefused() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo draft = listingSteps.createOlxProductListing(account,
        ProductRequestPojo.withPriceFloor(CURRENT_PRICE, FLOOR));

    ValidatableResponse refused = productSteps.updateSellingPrice(account, draft.productId(), BELOW_FLOOR);
    productSteps.verify()
        .verifyResponseStatusCode(refused, HttpStatus.SC_UNPROCESSABLE_ENTITY)
        .hasFailed(refused);

    ValidatableResponse product = productSteps.getProduct(account, draft.productId());
    productSteps.verify().hasSellingPrice(product, CURRENT_PRICE);
    ValidatableResponse listing = listingSteps.getListing(account, draft.listingId());
    listingSteps.verify().hasPrice(listing, CURRENT_PRICE);
  }

  @Test
  public void editLoweringFloorAndPriceTogetherApplies() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo live = listingSteps.publishSandboxOlxListing(account,
        ProductRequestPojo.withPriceFloor(CURRENT_PRICE, FLOOR));

    ValidatableResponse response = productSteps.updateSellingPriceAndFloor(account, live.productId(), BELOW_FLOOR,
        LOWERED_FLOOR);
    productSteps.verify()
        .queuedOlxUpdates(response, 1)
        .hasSellingPrice(response, BELOW_FLOOR)
        .hasMinAcceptablePrice(response, LOWERED_FLOOR);
  }
}
