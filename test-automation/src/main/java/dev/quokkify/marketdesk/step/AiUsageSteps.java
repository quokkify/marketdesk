package dev.quokkify.marketdesk.step;

import java.time.Duration;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.service.AiUsageService;
import dev.quokkify.marketdesk.verification.AiUsageVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.awaitility.Awaitility;
import org.awaitility.core.ConditionTimeoutException;

public class AiUsageSteps extends ApiSteps<AiUsageVerification> {

  private static final Duration USAGE_TIMEOUT = Duration.ofSeconds(5);
  private static final Duration USAGE_POLL_INTERVAL = Duration.ofMillis(250);

  private final AiUsageService service = new AiUsageService();

  public AiUsageSteps() {
    this.verification = new AiUsageVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Get AI usage of the workspace")
  public ValidatableResponse getUsage(AccountPojo account) {
    return service.getUsage(account.token());
  }

  // The backend stores a call after answering, so the usage report catches up a moment later.
  @Step("Wait until today's usage counts {analyses} analyses")
  public ValidatableResponse getUsageOnceCounted(AccountPojo account, int analyses) {
    ValidatableResponse[] last = new ValidatableResponse[1];
    try {
      Awaitility.await().atMost(USAGE_TIMEOUT).pollInterval(USAGE_POLL_INTERVAL).until(() -> {
        last[0] = service.getUsage(account.token());
        return last[0].extract().jsonPath().getInt("data.today.analyses") == analyses;
      });
    } catch (ConditionTimeoutException e) {
      // The caller's verification reports the actual count.
    }
    return last[0];
  }

  @Step("Get AI usage without authentication")
  public ValidatableResponse getUsageUnauthenticated() {
    return service.getUsage();
  }
}
