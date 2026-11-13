package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.page.LoginPage;
import dev.quokkify.marketdesk.verification.LoginVerification;
import dev.quokkify.model.PageSteps;

import io.qameta.allure.Step;

public class LoginPageSteps extends PageSteps<LoginPageSteps, LoginVerification, LoginPage> {

  public LoginPageSteps() {
    this(new LoginPage());
  }

  public LoginPageSteps(LoginPage page) {
    this.page = page;
    this.verification = new LoginVerification(this, page);
  }

  @Step("Open the login page")
  public LoginPageSteps openLoginPage() {
    page.open();
    return this;
  }

  @Step("Sign in as {email}")
  public LoginPageSteps signIn(String email, String password) {
    page.fillEmail(email);
    page.fillPassword(password);
    page.submit();
    return this;
  }
}
