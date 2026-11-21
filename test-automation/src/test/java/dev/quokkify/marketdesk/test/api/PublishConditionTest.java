package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

public class PublishConditionTest extends BaseTest {

  @Test
  public void refusesPublishingAProductWithUnknownCondition() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListingWithCondition(account, "unknown");
    listingSteps.verify().isConditionRefusal(listingSteps.publish(account, listingId));
  }

  // Guard: a product with a known condition passes the condition rule, whatever a later publish step answers.
  @Test
  public void publishesAProductWithAKnownCondition() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListingWithCondition(account, "good");
    listingSteps.verify().isNotValidationRefusal(listingSteps.publish(account, listingId));
  }
}
