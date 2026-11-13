package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;

import org.testng.annotations.Test;

public class LoginUiTest extends BaseUiTest {

  @Test
  public void signsInAndLandsOnProducts() {
    AccountPojo account = authSteps.registerNewAccount();
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }
}
