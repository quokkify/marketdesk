package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.time.Instant;

import dev.quokkify.marketdesk.helper.HermesUsageFileHelper;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.service.HermesLimitsService;
import dev.quokkify.marketdesk.verification.HermesLimitsVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.awaitility.core.ConditionTimeoutException;

public class HermesLimitsSteps extends ApiSteps<HermesLimitsVerification> {

  private static final Duration LIMITS_TIMEOUT = Duration.ofSeconds(5);
  private static final Duration LIMITS_POLL_INTERVAL = Duration.ofMillis(100);

  private final HermesLimitsService service = new HermesLimitsService();
  private final HermesUsageFileHelper usageFile = new HermesUsageFileHelper();

  public HermesLimitsSteps() {
    this.verification = new HermesLimitsVerification();
  }

  @Step("Hermes wrote limits fetched {age} ago")
  public void writeLimitsFetchedAgo(Duration age) {
    usageFile.writeLimits(Instant.now().minus(age));
  }

  @Step("Hermes wrote limits dated {ahead} in the future")
  public void writeLimitsFetchedInFuture(Duration ahead) {
    usageFile.writeLimits(Instant.now().plus(ahead));
  }

  @Step("Hermes failed to fetch limits: {reason}")
  public void writeUnavailable(String reason) {
    usageFile.writeUnavailable(reason, Instant.now());
  }

  @Step("The limits file is half-written")
  public void writeBrokenFile() {
    usageFile.writeRaw("{\"provider\":");
  }

  @Step("The limits file is empty")
  public void writeEmptyFile() {
    usageFile.writeRaw("");
  }

  @Step("The limits file is missing")
  public void deleteFile() {
    usageFile.deleteFile();
  }

  // The file reaches the container through a bind mount, which on a developer machine (Docker Desktop) can show
  // the previous file for a moment, so wait until the endpoint reports the written state.
  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Get Hermes limits once they are {state}")
  public ValidatableResponse getLimitsOnceReported(AccountPojo account, String state) {
    try {
      Waiter.awaitCondition(() -> state.equals(limitsState(account)), "limits are " + state, LIMITS_TIMEOUT,
          LIMITS_POLL_INTERVAL);
    } catch (ConditionTimeoutException e) {
      // The caller's verification reports the actual state from the final request below.
    }
    return service.getLimits(account.token());
  }

  private String limitsState(AccountPojo account) {
    return service.getLimits(account.token()).extract().jsonPath().getString("data.state");
  }

  @Step("Get Hermes limits without authentication")
  public ValidatableResponse getLimitsUnauthenticated() {
    return service.getLimits();
  }
}
