package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

public class PriceResearchTest extends BaseTest {

  @Test
  public void savedPriceResearchIsReturned() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research);
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(account, productId), research);
  }

  @Test
  public void clearingRetailAnchorStoresNull() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research);
    priceResearchSteps.savePriceResearch(account, productId, research.withoutRetailAnchor());
    priceResearchSteps.verify().hasNoRetailAnchor(priceResearchSteps.getPriceResearch(account, productId));
  }

  @Test
  public void negativeRetailPriceIsRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withRetailPrice(-1.0)));
  }

  @Test
  public void elevenComparablesAreRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withTooManyComparables()));
  }

  @Test
  public void otherWorkspaceCannotReadOrWritePriceResearch() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(owner);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(owner, productId, research);
    AccountPojo stranger = authSteps.registerNewAccount();
    priceResearchSteps.verify().isNotFound(priceResearchSteps.getPriceResearch(stranger, productId));
    priceResearchSteps.verify().isNotFound(
        priceResearchSteps.savePriceResearch(stranger, productId, research.withRetailPrice(1.0)));
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(owner, productId), research);
  }

  @Test
  public void priceResearchRequiresLogin() {
    String productId = UUID.randomUUID().toString();
    priceResearchSteps.verify().isUnauthenticated(priceResearchSteps.getPriceResearchUnauthenticated(productId));
    priceResearchSteps.verify().isUnauthenticated(
        priceResearchSteps.savePriceResearchUnauthenticated(productId, PriceResearchPojo.sample()));
  }
}
