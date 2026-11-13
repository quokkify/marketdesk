package dev.quokkify.marketdesk.test.api;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.Test;

public class AuthTest extends BaseTest {

  @Test
  public void registersAccountAndReadsCurrentUser() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = authSteps.getCurrentUser(account);
    authSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasUserEmail(response, account.email());
  }

  @Test
  public void logsInWithRegisteredCredentials() {
    AccountPojo account = authSteps.registerNewAccount();
    ValidatableResponse response = authSteps.login(account.email(), account.password());
    authSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_OK)
        .hasSucceeded(response)
        .hasToken(response);
  }

  @Test
  public void registersTwoAccountsWithDifferentEmails() {
    AccountPojo first = authSteps.registerNewAccount();
    AccountPojo second = authSteps.registerNewAccount();
    authSteps.verify().hasDifferentEmails(first, second);
  }
}
