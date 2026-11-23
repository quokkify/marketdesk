package dev.quokkify.marketdesk.verification;

import java.util.Set;

import dev.quokkify.marketdesk.model.ListingResponsePojo;
import dev.quokkify.util.JsonConverter;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

import static org.assertj.core.api.Assertions.assertThat;

public class ResponseVerification extends BaseApiVerification<ResponseVerification> {

  private static final String STATS_RESPONSE = "data.byProductId.'%s'.response";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String COMPLETED = "completed";
  private static final String OK = "ok";
  private static final String FAILED = "failed";
  private static final String DEEP_IN_RESULTS = "deep_in_results";
  private static final String NO_VERDICT = "no_verdict";
  private static final String PROBE_FAILED = "probe_failed";
  private static final String CROWDED_MARKET = "crowded_market";
  private static final int CARDS_PER_PAGE = 40;

  @Override
  protected ResponseVerification self() {
    return this;
  }

  @Step("The statistics of product {productId} give the response stage {stage}")
  public ResponseVerification statsShowStage(ValidatableResponse stats, String productId, String stage) {
    verifyResponseStatusCode(stats, HttpStatus.SC_OK);
    stats.body(STATS_RESPONSE.formatted(productId) + ".stage", Matchers.equalTo(stage));
    stats.body(STATS_RESPONSE.formatted(productId) + ".listingId", Matchers.notNullValue());
    return self();
  }

  @Step("A new run is queued")
  public ResponseVerification isEnqueued(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
    response.body("data.reused", Matchers.equalTo(false));
    response.body("data.run.status", Matchers.in(Set.of("queued", "running")));
    return self();
  }

  // 200 instead of 202: the run already queued, running or just completed is handed back, nothing is enqueued.
  @Step("No new run is queued")
  public ResponseVerification isNotEnqueued(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.run.id", Matchers.notNullValue());
    return self();
  }

  @Step("Both requests got the run {firstRunId}")
  public ResponseVerification isSameRun(String firstRunId, String secondRunId) {
    assertThat(secondRunId).isNotNull().isEqualTo(firstRunId);
    return self();
  }

  @Step("Request is rejected as not found")
  public ResponseVerification isNotFound(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_NOT_FOUND);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(NOT_FOUND));
    return self();
  }

  @Step("The latest run completed for the stage {stage}")
  public ResponseVerification completedWithStage(ValidatableResponse view, String stage) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body("data.lastFailed", Matchers.equalTo(false));
    ListingResponsePojo run = latestRun(view);
    assertThat(run.status()).isEqualTo(COMPLETED);
    assertThat(run.stage()).isEqualTo(stage);
    return self();
  }

  @Step("The run searched nothing and only says the listing was never analysed")
  public ResponseVerification searchedNothing(ValidatableResponse view) {
    ListingResponsePojo run = latestRun(view);
    assertThat(run.probes()).isEmpty();
    assertThat(run.findingCodes()).containsExactly(NO_VERDICT);
    return self();
  }

  // 40 organic cards on page 1 and the advert as the 17th of page 2: position and checked are both 57.
  @Step("The search for {query} found the advert at organic position {position} of {total}")
  public ResponseVerification isDeepInResults(ValidatableResponse view, String query, int position, int total) {
    ListingResponsePojo run = latestRun(view);
    assertThat(run.probes()).containsExactly(
        new ListingResponsePojo.Probe(query, OK, total, CARDS_PER_PAGE, position, position));
    assertThat(run.findingCodes()).containsExactly(DEEP_IN_RESULTS, NO_VERDICT, CROWDED_MARKET);
    assertThat(run.findings().get(0).evidence())
        .containsEntry("query", query)
        .containsEntry("position", position)
        .containsEntry("checked", position)
        .containsEntry("total", total);
    return self();
  }

  @Step("The search for {query} failed and the run reports it once, as not checked")
  public ResponseVerification probeFailed(ValidatableResponse view, String query) {
    ListingResponsePojo run = latestRun(view);
    assertThat(run.probes()).singleElement().satisfies(probe -> {
      assertThat(probe.query()).isEqualTo(query);
      assertThat(probe.status()).isEqualTo(FAILED);
      assertThat(probe.position()).isNull();
    });
    assertThat(run.findingCodes()).containsExactly(NO_VERDICT, PROBE_FAILED);
    return self();
  }

  private static ListingResponsePojo latestRun(ValidatableResponse view) {
    Object latest = view.extract().path("data.latest");
    assertThat(latest).as("the latest completed run").isNotNull();
    return JsonConverter.fromObject(latest, ListingResponsePojo.class);
  }
}
