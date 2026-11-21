package dev.quokkify.marketdesk.test.api;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The API stack has no research profile; the real OLX search is checked by hand on production.
public class ComparableSearchTest extends BaseTest {

  @Test
  public void searchWithoutResearchProfileIsNotConfigured() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isSearchNotConfigured(priceResearchSteps.searchComparables(account, productId));
  }

  @Test
  public void otherWorkspaceSearchIs404() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(owner);
    AccountPojo stranger = authSteps.registerNewAccount();
    priceResearchSteps.verify().isNotFound(priceResearchSteps.searchComparables(stranger, productId));
  }

  @Test
  public void searchRequiresLogin() {
    String productId = UUID.randomUUID().toString();
    priceResearchSteps.verify().isUnauthenticated(priceResearchSteps.searchComparablesUnauthenticated(productId));
  }
}
