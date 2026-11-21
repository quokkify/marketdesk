package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.MarketplacesPage;
import dev.quokkify.marketdesk.step.MarketplacesPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class MarketplacesPageVerification
    extends Verification<MarketplacesPageSteps, MarketplacesPageVerification, MarketplacesPage> {

  public MarketplacesPageVerification(MarketplacesPageSteps steps, MarketplacesPage page) {
    super(steps, page);
  }

  @Step("OLX is connected: Sync now is shown")
  public MarketplacesPageVerification olxIsConnected() {
    page.syncNowButton().shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("Import from OLX is not offered")
  public MarketplacesPageVerification importFromOlxIsNotOffered() {
    page.importFromOlxButton().shouldNot(Condition.exist);
    return this;
  }
}
