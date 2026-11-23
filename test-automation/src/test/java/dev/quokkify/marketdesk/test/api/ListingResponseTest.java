package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.OlxSearchPagePojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

// The real listing response graph runs through the stack. The stand's MockServer stands in for the main Hermes
// profile (only the buyer-queries call is answered) and serves synthetic OLX search pages. The stub OLX cannot age an
// advert or give it views, so the synced listing state is seeded in the database. Each product name is its own buyer
// query, so the tests never share a canned answer or a search page.
public class ListingResponseTest extends BaseTest {

  private static final String TOO_EARLY = "too_early";
  private static final String NOT_SEEN = "not_seen";
  private static final int FRESH_HOURS = 1;
  private static final int NOT_SEEN_HOURS = 72;
  private static final int FEW_VIEWS = 10;
  private static final int POSITION = 57;
  private static final int TOTAL = 966;

  private AccountPojo accountWithSandbox() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    return account;
  }

  private ProductListingPojo liveListing(AccountPojo account, ProductRequestPojo product, String advertId,
      int hoursLive) {
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);
    listingSteps.markLiveOnOlx(created.listingId(), advertId, hoursLive, FEW_VIEWS);
    return created;
  }

  @Test
  public void tooEarlyListingAnswersWithoutSearching() {
    AccountPojo account = accountWithSandbox();
    ProductRequestPojo product = ProductRequestPojo.responseSample();
    ProductListingPojo created = liveListing(account, product, OlxSearchPagePojo.newAdvertId(), FRESH_HOURS);
    responseSteps.verify().statsShowStage(productSteps.getProductStats(account), created.productId(), TOO_EARLY);

    responseSteps.verify().isEnqueued(responseSteps.requestRun(account, created.productId()));

    responseSteps.verify()
        .completedWithStage(responseSteps.awaitRun(account, created.productId()), TOO_EARLY)
        .searchedNothing(responseSteps.getView(account, created.productId()));
    hermesMockSteps.verify()
        .receivedExpectedCalls(hermesMockSteps.checkQueriesCalls(product.name(), 0))
        .receivedExpectedCalls(hermesMockSteps.checkSearchRequests(product.name(), 0));
  }

  @Test
  public void notSeenListingReportsItsSearchPosition() {
    AccountPojo account = accountWithSandbox();
    ProductRequestPojo product = ProductRequestPojo.responseSample();
    String advertId = OlxSearchPagePojo.newAdvertId();
    ProductListingPojo created = liveListing(account, product, advertId, NOT_SEEN_HOURS);
    hermesMockSteps.answerSearchWithAdvertDeepInResults(product.name(), product.name(), advertId);
    responseSteps.verify().statsShowStage(productSteps.getProductStats(account), created.productId(), NOT_SEEN);

    responseSteps.verify().isEnqueued(responseSteps.requestRun(account, created.productId()));

    ValidatableResponse view = responseSteps.awaitRun(account, created.productId());
    responseSteps.verify()
        .completedWithStage(view, NOT_SEEN)
        .isDeepInResults(view, product.name(), POSITION, TOTAL);
    hermesMockSteps.verify()
        .receivedExpectedCalls(hermesMockSteps.checkQueriesCalls(product.name(), 1))
        .receivedExpectedCalls(hermesMockSteps.checkSearchRequests(product.name(), 2));
  }

  @Test
  public void failedSearchIsReportedAsNotChecked() {
    AccountPojo account = accountWithSandbox();
    ProductRequestPojo product = ProductRequestPojo.responseSample();
    ProductListingPojo created = liveListing(account, product, OlxSearchPagePojo.newAdvertId(), NOT_SEEN_HOURS);
    hermesMockSteps.answerQueries(product.name(), product.name());
    hermesMockSteps.failSearch(product.name(), HttpStatus.SC_FORBIDDEN);

    responseSteps.verify().isEnqueued(responseSteps.requestRun(account, created.productId()));

    ValidatableResponse view = responseSteps.awaitRun(account, created.productId());
    responseSteps.verify()
        .completedWithStage(view, NOT_SEEN)
        .probeFailed(view, product.name());
    hermesMockSteps.verify().receivedExpectedCalls(hermesMockSteps.checkSearchRequests(product.name(), 1));
  }

  @Test
  public void secondRequestReturnsTheSameRun() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo created = liveListing(account, ProductRequestPojo.responseSample(),
        OlxSearchPagePojo.newAdvertId(), FRESH_HOURS);
    ValidatableResponse first = responseSteps.requestRun(account, created.productId());
    responseSteps.verify().isEnqueued(first);

    ValidatableResponse second = responseSteps.requestRun(account, created.productId());

    responseSteps.verify()
        .isNotEnqueued(second)
        .isSameRun(responseSteps.runId(first), responseSteps.runId(second));
  }

  @Test
  public void responseRunOfAnotherWorkspaceIsNotFound() {
    AccountPojo owner = accountWithSandbox();
    ProductListingPojo created = liveListing(owner, ProductRequestPojo.responseSample(),
        OlxSearchPagePojo.newAdvertId(), NOT_SEEN_HOURS);
    AccountPojo stranger = authSteps.registerNewAccount();

    responseSteps.verify()
        .isNotFound(responseSteps.requestRun(stranger, created.productId()))
        .isNotFound(responseSteps.getView(stranger, created.productId()));
  }
}
