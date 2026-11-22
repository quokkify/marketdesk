package dev.quokkify.marketdesk.test.api;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class ProductStatsTest extends BaseTest {

  private static final String ACTIVE = "active";
  private static final String LISTING_PROBLEM = "listing_problem";

  @Test
  public void statsListEveryListedProduct() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    ValidatableResponse response = productSteps.getProductStats(account);
    productSteps.verify().statsCoverProduct(response, productListing.productId());
  }

  @Test
  public void pendingCountsFollowSuggestions() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    List<String> eventIds = productSteps.runHermes(account, productListing.productId());
    productSteps.verify().hasPendingSuggestions(productSteps.getPendingCounts(account), productListing.productId());
    for (String eventId : eventIds) {
      productSteps.verify().verifyResponseStatusCode(productSteps.dismissEvent(account, eventId), HttpStatus.SC_OK);
    }
    productSteps.verify().hasNoPendingSuggestions(productSteps.getPendingCounts(account), productListing.productId());
  }

  @Test
  public void expiredActiveProductNeedsAction() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo active = listingSteps.createExpiredOlxProductListing(account);
    productSteps.verify().verifyResponseStatusCode(
        productSteps.updateStatus(account, active.productId(), ACTIVE), HttpStatus.SC_OK);
    ProductListingPojo draft = listingSteps.createExpiredOlxProductListing(account);
    ValidatableResponse list = productSteps.getNeedsActionProducts(account);
    productSteps.verify()
        .listsProduct(list, active.productId())
        .doesNotListProduct(list, draft.productId())
        .statsNeedAction(productSteps.getProductStats(account), active.productId(), LISTING_PROBLEM);
  }

  @Test
  public void rejectsUnauthenticatedStats() {
    productSteps.verify()
        .verifyResponseStatusCode(productSteps.getProductStatsUnauthenticated(), HttpStatus.SC_UNAUTHORIZED)
        .verifyResponseStatusCode(productSteps.getPendingCountsUnauthenticated(), HttpStatus.SC_UNAUTHORIZED);
  }
}
