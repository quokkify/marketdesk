package dev.quokkify.marketdesk.test.api;

import java.util.List;
import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

// The API stack has no research profile and offline Hermes heuristics, so the price check cannot estimate.
public class SaleVerdictTest extends BaseTest {

  private static final String INFO = "info";
  private static final String PRICE = "price";
  private static final String PHOTOS = "photos";
  private static final String NEEDS_HUMAN = "needs_human";
  private static final String FIX = "fix";

  private AccountPojo accountWithSandbox() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    return account;
  }

  private ValidatableResponse analyzeAndAwait(AccountPojo account, String productId) {
    verdictSteps.verify().isAccepted(verdictSteps.runAnalyze(account, productId), INFO, PRICE, PHOTOS);
    return verdictSteps.awaitVerdict(account, productId);
  }

  @Test
  public void analyzeQueuesARunAndCompletes() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.verify().isAccepted(verdictSteps.runAnalyze(account, productListing.productId()), INFO, PRICE, PHOTOS);
    verdictSteps.verify().isCompletedWithChecks(
        verdictSteps.awaitVerdict(account, productListing.productId()), INFO, PRICE, PHOTOS);
  }

  @Test
  public void productWithoutListingGetsPriceNeedsHuman() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample().withPhoto());
    ValidatableResponse view = analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkIs(view, PRICE, NEEDS_HUMAN, "no_listing")
        .checkStatusIs(view, INFO, "ready")
        .checkStatusIs(view, PHOTOS, "ready");
  }

  @Test
  public void researchNotConfiguredGetsPriceNeedsHuman() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.verify().checkIs(analyzeAndAwait(account, productListing.productId()), PRICE, NEEDS_HUMAN,
        "not_configured");
  }

  // The price research and estimate are PLN-only, so a listing in another currency is left to the seller.
  @Test
  public void nonPlnListingGetsPriceNeedsHuman() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account,
        ProductRequestPojo.sample().withPhoto().withCurrency("EUR"));
    verdictSteps.verify().checkIs(analyzeAndAwait(account, productListing.productId()), PRICE, NEEDS_HUMAN, "not_pln");
  }

  @Test
  public void noPhotosIsFix() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample());
    ValidatableResponse view = analyzeAndAwait(account, productId);
    verdictSteps.verify()
        .checkIs(view, PHOTOS, FIX, "photos_missing")
        .overallIsNotReady(view);
  }

  @Test
  public void missingConditionIsInfoFix() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample().withCondition("unknown"));
    verdictSteps.verify().checkStatusIs(analyzeAndAwait(account, productId), INFO, FIX);
  }

  // Two requests back to back: the second finds the product's active run (one active run per product).
  @Test
  public void secondRequestReturnsActiveRun() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample().withPhoto());
    ValidatableResponse first = verdictSteps.runAnalyze(account, productId);
    ValidatableResponse second = verdictSteps.runAnalyze(account, productId);
    String firstId = verdictSteps.runId(first);
    String secondId = verdictSteps.runId(second);
    // On a fast stack the first run can finish before the second POST, which then rightly starts a new
    // run. The invariant is never two active runs: the same run, or the first one had completed by then.
    if (!firstId.equals(secondId)) {
      verdictSteps.verify().firstRunEndedBeforeSecond(verdictSteps.getVerdict(account, productId), firstId, secondId,
          verdictSteps.createdAt(second));
    }
    verdictSteps.awaitVerdict(account, productId);
  }

  // The scope goes through a TEXT[] column: what was sent comes back.
  @Test
  public void priceScopeKeepsOtherChecks() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample().withPhoto());
    ValidatableResponse before = analyzeAndAwait(account, productId);
    String infoBefore = verdictSteps.checkedAt(before, INFO);
    String photosBefore = verdictSteps.checkedAt(before, PHOTOS);
    String priceBefore = verdictSteps.checkedAt(before, PRICE);

    verdictSteps.verify().isAccepted(verdictSteps.runScope(account, productId, List.of(PRICE)), PRICE);
    ValidatableResponse after = verdictSteps.awaitVerdict(account, productId);
    verdictSteps.verify()
        .isCompletedWithChecks(after, INFO, PRICE, PHOTOS)
        .isUnchanged(infoBefore, verdictSteps.checkedAt(after, INFO))
        .isUnchanged(photosBefore, verdictSteps.checkedAt(after, PHOTOS))
        .isLater(priceBefore, verdictSteps.checkedAt(after, PRICE));
  }

  @Test
  public void offlineSeoDoesNotFailVerdict() {
    AccountPojo account = accountWithSandbox();
    verdictSteps.enableListingSeo(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    ValidatableResponse view = analyzeAndAwait(account, productListing.productId());
    verdictSteps.verify().isCompletedWithChecks(view, INFO, PRICE, PHOTOS);
  }

  @Test
  public void otherWorkspaceIs404() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(owner, ProductRequestPojo.sample());
    AccountPojo stranger = authSteps.registerNewAccount();
    verdictSteps.verify().isNotFound(verdictSteps.runAnalyze(stranger, productId));
    verdictSteps.verify().isNotFound(verdictSteps.getVerdict(stranger, productId));
    verdictSteps.verify().hasNothing(verdictSteps.getVerdict(owner, productId));
  }

  @Test
  public void requiresLogin() {
    String productId = UUID.randomUUID().toString();
    verdictSteps.verify().isUnauthenticated(verdictSteps.runAnalyzeUnauthenticated(productId));
    verdictSteps.verify().isUnauthenticated(verdictSteps.getVerdictUnauthenticated(productId));
  }

  // Two products: the catalogue reads each one's latest verdict in one query.
  @Test
  public void catalogueCarriesLatestVerdict() {
    AccountPojo account = authSteps.registerNewAccount();
    String first = verdictSteps.createProduct(account, ProductRequestPojo.sample().withPhoto());
    String second = verdictSteps.createProduct(account, ProductRequestPojo.sample());
    analyzeAndAwait(account, first);
    analyzeAndAwait(account, second);
    ValidatableResponse products = verdictSteps.getProducts(account);
    verdictSteps.verify()
        .catalogueCarries(products, first)
        .catalogueCarries(products, second);
  }

  @Test
  public void recheckWritesInfoCheck() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    verdictSteps.verify().recheckAnswers(
        verdictSteps.recheck(account, productListing.productId(), productListing.listingId()),
        productListing.listingId());
    ValidatableResponse view = verdictSteps.getVerdict(account, productListing.productId());
    verdictSteps.verify().isCompletedWithChecks(view, INFO);
    verdictSteps.verify().isLater("1970-01-01T00:00:00Z", verdictSteps.checkedAt(view, INFO));
  }

  // The Improve endpoint was removed with the single-prompt pricing.
  @Test
  public void improvementsEndpointIsGone() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = verdictSteps.createProduct(account, ProductRequestPojo.sample());
    verdictSteps.verify().isEndpointGone(verdictSteps.requestImprovements(account, productId));
  }

  // No research is stored on this stack, so the revival proposal has no estimate to take a price from.
  @Test
  public void revivalProposalWithoutResearchHasNoPrice() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createExpiredOlxProductListing(account).listingId();
    listingSteps.verify().hasPriceIssueAndNoPriceProposal(listingSteps.requestRevivalProposal(account, listingId));
  }

  // The refresh runs the price scope of a verdict: without a research profile it still answers "not
  // configured", and neither it nor the verdict's price check leaves a research run row.
  @Test
  public void refreshResearchRunsPriceScope() {
    AccountPojo account = accountWithSandbox();
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    String productId = productListing.productId();
    priceResearchSteps.verify().isRefreshNotConfigured(priceResearchSteps.refreshPriceResearch(account, productId));
    verdictSteps.verify().checkIs(analyzeAndAwait(account, productId), PRICE, NEEDS_HUMAN, "not_configured");
    priceResearchSteps.verify().hasNoRun(priceResearchSteps.getPriceResearch(account, productId));
  }
}
