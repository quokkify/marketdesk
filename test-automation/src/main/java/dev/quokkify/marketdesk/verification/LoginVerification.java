package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.LoginPage;
import dev.quokkify.marketdesk.step.LoginPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class LoginVerification extends Verification<LoginPageSteps, LoginVerification, LoginPage> {

  public LoginVerification(LoginPageSteps steps, LoginPage page) {
    super(steps, page);
  }

  @Step("Products catalogue is shown")
  public LoginVerification productsCatalogueIsShown() {
    page.searchProductsField().shouldBe(Condition.visible, getTimeout());
    return this;
  }
}
