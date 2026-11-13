package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.assertj.core.api.Assertions;
import org.hamcrest.Matchers;

public class AuthVerification extends BaseApiVerification<AuthVerification> {

  @Override
  protected AuthVerification self() {
    return this;
  }

  @Step("Response reports success")
  public AuthVerification hasSucceeded(ValidatableResponse response) {
    response.body("success", Matchers.equalTo(true));
    return self();
  }

  @Step("Response carries a token")
  public AuthVerification hasToken(ValidatableResponse response) {
    response.body("data.token", Matchers.not(Matchers.emptyOrNullString()));
    return self();
  }

  @Step("User email is {expected}")
  public AuthVerification hasUserEmail(ValidatableResponse response, String expected) {
    response.body("data.email", Matchers.equalTo(expected));
    return self();
  }

  @Step("Accounts have different emails")
  public AuthVerification hasDifferentEmails(AccountPojo first, AccountPojo second) {
    Assertions.assertThat(first.email()).isNotEqualTo(second.email());
    return self();
  }
}
