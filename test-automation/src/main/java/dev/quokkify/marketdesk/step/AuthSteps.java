package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.helper.AccountHelper;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.CredentialsPojo;
import dev.quokkify.marketdesk.service.AuthService;
import dev.quokkify.marketdesk.verification.AuthVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;

public class AuthSteps extends ApiSteps<AuthVerification> {

  private final AuthService service = new AuthService();
  private final AccountHelper accountHelper = new AccountHelper();

  public AuthSteps() {
    this.verification = new AuthVerification();
  }

  @Step("Register a new account")
  public AccountPojo registerNewAccount() {
    return accountHelper.registerNewAccount();
  }

  @Step("Log in as {email}")
  public ValidatableResponse login(String email, String password) {
    return service.login(new CredentialsPojo(email, password));
  }

  @Step("Get the current user")
  public ValidatableResponse getCurrentUser(String token) {
    return service.getCurrentUser(token);
  }
}
