package dev.quokkify.marketdesk.verification;

import java.time.Instant;
import java.util.Set;

import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class VerdictVerification extends BaseApiVerification<VerdictVerification> {

  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String LATEST = "data.latest";
  private static final String CHECKS = LATEST + ".checks.";
  private static final String GRAPH_VERSION = "sale-verdict@1";
  private static final String COMPLETED = "completed";

  @Override
  protected VerdictVerification self() {
    return this;
  }

  @Step("The run is accepted as queued or running with the scope {scope}")
  public VerdictVerification isAccepted(ValidatableResponse response, String... scope) {
    verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
    response.body("data.status", Matchers.in(Set.of("queued", "running")));
    response.body("data.scope", Matchers.contains(scope));
    return self();
  }

  @Step("The verdict is completed with the graph version and the checks {checks}")
  public VerdictVerification isCompletedWithChecks(ValidatableResponse view, String... checks) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body(LATEST + ".status", Matchers.equalTo(COMPLETED));
    view.body(LATEST + ".graphVersion", Matchers.equalTo(GRAPH_VERSION));
    MatcherAssert.assertThat(view.extract().jsonPath().getMap(LATEST + ".checks").keySet(),
        Matchers.containsInAnyOrder(checks));
    return self();
  }

  @Step("The check {check} is {status} with the reason {code}")
  public VerdictVerification checkIs(ValidatableResponse view, String check, String status, String code) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body(CHECKS + check + ".status", Matchers.equalTo(status));
    view.body(CHECKS + check + ".reasons.code", Matchers.hasItem(code));
    return self();
  }

  @Step("The check {check} is {status}")
  public VerdictVerification checkStatusIs(ValidatableResponse view, String check, String status) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body(CHECKS + check + ".status", Matchers.equalTo(status));
    return self();
  }

  @Step("The overall verdict is not ready")
  public VerdictVerification overallIsNotReady(ValidatableResponse view) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body(LATEST + ".overall", Matchers.not(Matchers.equalTo("ready")));
    return self();
  }

  @Step("Both requests got the same run")
  public VerdictVerification isSameRun(String first, String second) {
    MatcherAssert.assertThat(second, Matchers.equalTo(first));
    return self();
  }

  // The latest completed run is the first one (it must have ended before the second was created) or the
  // second one (so the first had ended, or the second could not have been inserted).
  @Step("The first run {firstId} had ended when the second run {secondId} was created")
  public VerdictVerification firstRunEndedBeforeSecond(ValidatableResponse view, String firstId, String secondId,
      String secondCreatedAt) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    String latestId = view.extract().path(LATEST + ".id");
    if (firstId.equals(latestId)) {
      String completedAt = view.extract().path(LATEST + ".completedAt");
      MatcherAssert.assertThat(completedAt, Matchers.notNullValue());
      MatcherAssert.assertThat(Instant.parse(completedAt), Matchers.lessThanOrEqualTo(Instant.parse(secondCreatedAt)));
    } else {
      MatcherAssert.assertThat(latestId, Matchers.equalTo(secondId));
    }
    return self();
  }

  @Step("The check time did not change")
  public VerdictVerification isUnchanged(String before, String after) {
    MatcherAssert.assertThat(after, Matchers.equalTo(before));
    return self();
  }

  @Step("The check time is later than before")
  public VerdictVerification isLater(String before, String after) {
    MatcherAssert.assertThat(Instant.parse(after), Matchers.greaterThan(Instant.parse(before)));
    return self();
  }

  @Step("The catalogue lists product {productId} with its latest verdict")
  public VerdictVerification catalogueCarries(ValidatableResponse products, String productId) {
    verifyResponseStatusCode(products, HttpStatus.SC_OK);
    products.body("data.find { it.id == '%s' }.verdict.overall".formatted(productId), Matchers.notNullValue());
    products.body("data.find { it.id == '%s' }.verdictLastFailed".formatted(productId), Matchers.is(false));
    return self();
  }

  @Step("The recheck answers with its items for the listing {listingId}")
  public VerdictVerification recheckAnswers(ValidatableResponse response, String listingId) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.listingId", Matchers.equalTo(listingId));
    response.body("data.items", Matchers.notNullValue());
    return self();
  }

  @Step("Nothing is queued and no verdict exists")
  public VerdictVerification hasNothing(ValidatableResponse view) {
    verifyResponseStatusCode(view, HttpStatus.SC_OK);
    view.body("data.active", Matchers.nullValue());
    view.body("data.latest", Matchers.nullValue());
    return self();
  }

  @Step("Request is rejected as not found")
  public VerdictVerification isNotFound(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_NOT_FOUND, NOT_FOUND);
  }

  @Step("The endpoint is gone and answers 404")
  public VerdictVerification isEndpointGone(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_NOT_FOUND);
    return self();
  }

  @Step("Request is rejected as unauthenticated")
  public VerdictVerification isUnauthenticated(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_UNAUTHORIZED, UNAUTHORIZED);
  }

  private VerdictVerification failsWith(ValidatableResponse response, int status, String code) {
    verifyResponseStatusCode(response, status);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }
}
