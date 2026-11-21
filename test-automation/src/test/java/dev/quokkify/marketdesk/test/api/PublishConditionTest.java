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

  // Guard: the product has no OLX category, so a known condition gets past the condition rule and meets the next
  // preflight step, the category guard (422). Only the unknown condition is refused earlier, with 400.
  @Test
  public void passesTheConditionRuleWithAKnownCondition() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    String listingId = listingSteps.createOlxListingWithCondition(account, "good");
    listingSteps.verify().isCategoryGuardRefusal(listingSteps.publish(account, listingId));
  }
}
