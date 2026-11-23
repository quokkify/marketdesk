package dev.quokkify.marketdesk.step;

import java.time.Duration;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.service.ResponseService;
import dev.quokkify.marketdesk.verification.ResponseVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;

public class ResponseSteps extends ApiSteps<ResponseVerification> {

  // A not_seen run asks Hermes and reads up to two search pages through a gate that pauses 1 s after each request,
  // shared with every other test's search on the stand.
  private static final Duration RUN_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);
  private static final String LATEST = "data.latest";

  private final ResponseService service = new ResponseService();

  public ResponseSteps() {
    this.verification = new ResponseVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Ask why product {productId} gets no response")
  public ValidatableResponse requestRun(AccountPojo account, String productId) {
    return service.requestRun(account.token(), productId);
  }

  @Step("Get the listing response view of product {productId}")
  public ValidatableResponse getView(AccountPojo account, String productId) {
    return service.getView(account.token(), productId);
  }

  // A run is over when nothing is active; it left a completed run, or the last run failed.
  @Step("Wait until the listing response run of product {productId} ends")
  public ValidatableResponse awaitRun(AccountPojo account, String productId) {
    Waiter.awaitCondition(() -> hasEnded(service.getView(account.token(), productId)),
        "the listing response run has ended", RUN_TIMEOUT, POLL_INTERVAL);
    return service.getView(account.token(), productId);
  }

  @Step("Read the run id")
  public String runId(ValidatableResponse response) {
    return response.extract().path("data.run.id");
  }

  private static boolean hasEnded(ValidatableResponse view) {
    boolean idle = view.extract().path("data.active") == null;
    boolean settled = view.extract().path(LATEST) != null
        || Boolean.TRUE.equals(view.extract().path("data.lastFailed"));
    return idle && settled;
  }
}
