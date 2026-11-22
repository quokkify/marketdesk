package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The real research graph runs through the stack against a MockServer in place of the Hermes research profile.
// Each test answers only the prompts about its own product, so the tests run in parallel without clearing the mock.
public class PriceResearchRunTest extends BaseTest {

  private static final String IDENTIFY = "identify";

  @Test
  public void allTiersAnsweredSavesTheLadder() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductRequestPojo product = ProductRequestPojo.researchSample();
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);
    hermesMockSteps.answerIdentify(product.name());
    hermesMockSteps.answerAllTiers(product.name());

    priceResearchSteps.verify().isRefreshAccepted(priceResearchSteps.refreshPriceResearch(account, created.productId()));

    priceResearchSteps.verify()
        .lastRunSucceeded(priceResearchSteps.awaitResearchRun(account, created.productId()), "ok")
        .hasAutoAnchorsOf(priceResearchSteps.getPriceResearch(account, created.productId()),
            "same_model_used", "last_new_price", "substitute_new", "substitute_used");
    hermesMockSteps.verify().receivedExpectedCalls(hermesMockSteps.checkCalls(product.name(), IDENTIFY, 1));
  }

  @Test
  public void identifyRetriesOnceAfterAnUnusableAnswer() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductRequestPojo product = ProductRequestPojo.researchSample();
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);
    hermesMockSteps.answerOnce(product.name(), IDENTIFY, "identify-prose.json");
    hermesMockSteps.answerIdentify(product.name());
    hermesMockSteps.answerAllTiers(product.name());

    priceResearchSteps.verify().isRefreshAccepted(priceResearchSteps.refreshPriceResearch(account, created.productId()));

    priceResearchSteps.verify()
        .lastRunSucceeded(priceResearchSteps.awaitResearchRun(account, created.productId()), "ok");
    hermesMockSteps.verify().receivedExpectedCalls(hermesMockSteps.checkCalls(product.name(), IDENTIFY, 2));
  }

  // The failure recorded on 2026-11-22: substitutesNew got no answer and substitutesUsed found nothing, so no
  // class-checked substitute backs the ladder and the run saves nothing.
  @Test
  public void noSubstitutesFailsTheRunAndSavesNothing() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductRequestPojo product = ProductRequestPojo.researchSample();
    ProductListingPojo created = listingSteps.createOlxProductListing(account, product);
    hermesMockSteps.answerIdentify(product.name());
    hermesMockSteps.answer(product.name(), "sameModelUsed", "same-model-used.json");
    hermesMockSteps.answer(product.name(), "lastNewPrice", "last-new-price.json");
    hermesMockSteps.answer(product.name(), "substitutesUsed", "substitutes-used-empty.json");
    priceResearchSteps.verify().hasNoResearch(priceResearchSteps.getPriceResearch(account, created.productId()));

    priceResearchSteps.verify().isRefreshAccepted(priceResearchSteps.refreshPriceResearch(account, created.productId()));

    priceResearchSteps.verify()
        .lastRunFailed(priceResearchSteps.awaitResearchRun(account, created.productId()), "no_substitutes",
            "substitute_new")
        .storesNothing(priceResearchSteps.getPriceResearch(account, created.productId()));
  }
}
