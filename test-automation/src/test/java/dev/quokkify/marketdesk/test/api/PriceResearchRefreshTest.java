package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API stack has no research profile; the real web research is checked by hand on production.
public class PriceResearchRefreshTest extends BaseTest {

  @Test
  public void refreshWithoutResearchProfileIsNotConfigured() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isRefreshNotConfigured(priceResearchSteps.refreshPriceResearch(account, productId));
  }

  @Test
  public void notConfiguredDoesNotTouchResearch() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isRefreshNotConfigured(priceResearchSteps.refreshPriceResearch(account, productId));
    priceResearchSteps.verify().hasNoResearch(priceResearchSteps.getPriceResearch(account, productId));
  }

  @Test
  public void otherWorkspaceRefreshIs404() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(owner);
    AccountPojo stranger = authSteps.registerNewAccount();
    priceResearchSteps.verify().isNotFound(priceResearchSteps.refreshPriceResearch(stranger, productId));
  }

  @Test
  public void refreshRequiresLogin() {
    String productId = UUID.randomUUID().toString();
    priceResearchSteps.verify().isUnauthenticated(priceResearchSteps.refreshPriceResearchUnauthenticated(productId));
  }
}
