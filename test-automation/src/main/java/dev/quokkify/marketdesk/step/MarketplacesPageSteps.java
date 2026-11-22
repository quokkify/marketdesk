package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.page.MarketplacesPage;
import dev.quokkify.marketdesk.verification.MarketplacesPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import io.qameta.allure.Step;

public class MarketplacesPageSteps
    extends PageSteps<MarketplacesPageSteps, MarketplacesPageVerification, MarketplacesPage> {

  public MarketplacesPageSteps() {
    this.page = Selenide.page(new MarketplacesPage());
    this.verification = new MarketplacesPageVerification(this, page);
  }

  @Step("Open the marketplaces page")
  public MarketplacesPageSteps openMarketplacesPage() {
    page.open();
    return this;
  }

  @Step("Connect the sandbox OLX account")
  public MarketplacesPageSteps connectSandboxOlx() {
    page.connectSandboxOlxButton().shouldBe(Condition.enabled).click();
    return this;
  }
}
