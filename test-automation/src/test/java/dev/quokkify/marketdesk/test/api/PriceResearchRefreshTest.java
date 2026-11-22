package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// Who may refresh. The research runs themselves are in PriceResearchRunTest; the "not configured" refusal is
// covered by the Jest tests, since the API stack now has a research profile.
public class PriceResearchRefreshTest extends BaseTest {

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
