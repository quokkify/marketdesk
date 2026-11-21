package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.service.AiUsageService;
import dev.quokkify.marketdesk.verification.AiUsageVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;

public class AiUsageSteps extends ApiSteps<AiUsageVerification> {

  private final AiUsageService service = new AiUsageService();

  public AiUsageSteps() {
    this.verification = new AiUsageVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Get AI usage of the workspace")
  public ValidatableResponse getUsage(AccountPojo account) {
    return service.getUsage(account.token());
  }

  @Step("Get AI usage without authentication")
  public ValidatableResponse getUsageUnauthenticated() {
    return service.getUsage();
  }
}
