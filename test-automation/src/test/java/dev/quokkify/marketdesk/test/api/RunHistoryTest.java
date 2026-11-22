package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

// The run history of a product: sale verdict runs and market search runs, newest first. On the API stack Hermes and
// the market search are answered by a mock, so the runs end failed; the history lists them all the same.
public class RunHistoryTest extends BaseTest {

  private static final String MANUAL = "manual";

  private AccountPojo accountWithSandbox() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    return account;
  }

  private String productWithTwoAnalyses(AccountPojo account) {
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample().withPhoto());
    verdictSteps.analyzeAndAwait(account, productId);
    verdictSteps.analyzeAndAwait(account, productId);
    return productId;
  }

  @Test
  public void verdictHistoryListsNewestFirst() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = productWithTwoAnalyses(account);
    ValidatableResponse history = verdictSteps.getVerdictHistory(account, productId);
    verdictSteps.verify().historyHasAtLeast(history, 2).historyIsNewestFirst(history);
  }

  @Test
  public void limitOneReturnsOneEntry() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = productWithTwoAnalyses(account);
    verdictSteps.verify().historyHasSize(verdictSteps.getVerdictHistory(account, productId, "1"), 1);
    priceResearchSteps.verify().historyHasSize(priceResearchSteps.getRunHistory(account, productId, "1"), 1);
  }

  @Test
  public void limitZeroAndFiftyOneAreRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample());
    verdictSteps.verify().isInvalid(verdictSteps.getVerdictHistory(account, productId, "0"));
    verdictSteps.verify().isInvalid(verdictSteps.getVerdictHistory(account, productId, "51"));
    priceResearchSteps.verify().isInvalid(priceResearchSteps.getRunHistory(account, productId, "0"));
    priceResearchSteps.verify().isInvalid(priceResearchSteps.getRunHistory(account, productId, "51"));
  }

  @Test
  public void unknownProductIs404() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(owner, ProductRequestPojo.sample());
    AccountPojo stranger = authSteps.registerNewAccount();
    verdictSteps.verify().isNotFound(verdictSteps.getVerdictHistory(stranger, productId));
    priceResearchSteps.verify().isNotFound(priceResearchSteps.getRunHistory(stranger, productId));
  }

  // The refresh forces a market search: its run is recorded as manual, and the verdict run that started it carries
  // that run's id.
  @Test
  public void researchRunsListTheForcedSearch() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    String productId = productListing.productId();
    priceResearchSteps.verify().isRefreshAccepted(priceResearchSteps.refreshPriceResearch(account, productId));
    verdictSteps.awaitVerdict(account, productId);
    priceResearchSteps.awaitResearchRun(account, productId);

    ValidatableResponse research = priceResearchSteps.getRunHistory(account, productId);
    priceResearchSteps.verify().newestRunHasTrigger(research, MANUAL);
    verdictSteps.verify().newestRunStartedSearch(verdictSteps.getVerdictHistory(account, productId),
        priceResearchSteps.newestRunId(research));
  }

  @Test
  public void productWithNoRunsReturnsEmptyList() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample());
    priceResearchSteps.verify().historyIsEmpty(priceResearchSteps.getRunHistory(account, productId));
    verdictSteps.verify().historyHasSize(verdictSteps.getVerdictHistory(account, productId), 0);
  }
}
