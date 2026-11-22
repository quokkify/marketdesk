package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.page.HermesActivityPage;
import dev.quokkify.marketdesk.verification.HermesActivityPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Selenide;
import io.qameta.allure.Step;

public class HermesActivityPageSteps
    extends PageSteps<HermesActivityPageSteps, HermesActivityPageVerification, HermesActivityPage> {

  public HermesActivityPageSteps() {
    this.page = Selenide.page(new HermesActivityPage());
    this.verification = new HermesActivityPageVerification(this, page);
  }

  @Step("Open the Hermes activity page")
  public HermesActivityPageSteps openHermesActivityPage() {
    page.open();
    return this;
  }
}
