package dev.quokkify.marketdesk.verification;

import java.util.List;

import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;

public class PriceResearchVerification extends BaseApiVerification<PriceResearchVerification> {

  private static final String UNAUTHORIZED = "UNAUTHORIZED";
  private static final String NOT_FOUND = "NOT_FOUND";
  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
  private static final String CONFLICT = "CONFLICT";
  private static final double PRICE_TOLERANCE = 0.001;
  private static final String RESEARCH_CHANGED = "Price research changed since you opened it. Reload and try again.";

  @Override
  protected PriceResearchVerification self() {
    return this;
  }

  @Step("Price research holds the saved retail anchor and comparables")
  public PriceResearchVerification holds(ValidatableResponse response, PriceResearchPojo expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    // A whole price such as 450 comes back as a JSON integer, so compare the value as a double.
    MatcherAssert.assertThat(response.extract().jsonPath().getDouble("data.retailPrice"),
        Matchers.closeTo(expected.retailPrice(), PRICE_TOLERANCE));
    response.body("data.retailCurrency", Matchers.equalTo(expected.retailCurrency()));
    response.body("data.retailSource", Matchers.equalTo(expected.retailSource()));
    response.body("data.retailCheckedAt", Matchers.equalTo(expected.retailCheckedAt()));
    // A whole price such as 250 comes back as a JSON integer, so read the list as doubles.
    MatcherAssert.assertThat(response.extract().jsonPath().getList("data.comparables.price", Double.class),
        Matchers.contains(expected.comparables().stream().map(PriceResearchPojo.Comparable::price).toArray()));
    response.body("data.comparables.note", Matchers.contains(
        expected.comparables().stream().map(PriceResearchPojo.Comparable::note).toArray()));
    return self();
  }

  @Step("Price research is saved")
  public PriceResearchVerification isSaved(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    return self();
  }

  @Step("Product has no price research")
  public PriceResearchVerification hasNoResearch(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data", Matchers.nullValue());
    return self();
  }

  @Step("Price research keeps the link and source of the comparable")
  public PriceResearchVerification keepsComparableLink(ValidatableResponse response, PriceResearchPojo.Comparable expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.comparables[0].url", Matchers.equalTo(expected.url()));
    response.body("data.comparables[0].source", Matchers.equalTo(expected.source()));
    return self();
  }

  @Step("Price research keeps the tier and date of the auto comparable")
  public PriceResearchVerification keepsAutoComparable(ValidatableResponse response, PriceResearchPojo.Comparable expected) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.comparables[0].source", Matchers.equalTo("auto"));
    response.body("data.comparables[0].tier", Matchers.equalTo(expected.tier()));
    response.body("data.comparables[0].seenAt", Matchers.equalTo(expected.seenAt()));
    return self();
  }

  @Step("Price research lists the dismissed link {url}")
  public PriceResearchVerification hasDismissed(ValidatableResponse response, String url) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.dismissedUrls", Matchers.contains(url));
    return self();
  }

  @Step("Price research has no retail anchor")
  public PriceResearchVerification hasNoRetailAnchor(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.retailPrice", Matchers.nullValue());
    response.body("data.retailCurrency", Matchers.nullValue());
    response.body("data.retailSource", Matchers.nullValue());
    response.body("data.retailCheckedAt", Matchers.nullValue());
    return self();
  }

  // The API stack has no Hermes, so the offline estimate has low confidence and must stay silent.
  @Step("The verdict's price check ran and proposed no price change and no price estimate notice")
  public PriceResearchVerification proposesNoPriceChange(ValidatableResponse verdict) {
    verifyResponseStatusCode(verdict, HttpStatus.SC_OK);
    verdict.body("data.latest.status", Matchers.equalTo("completed"));
    verdict.body("data.latest.checks.price.status", Matchers.notNullValue());
    verdict.body("data.latest.checks.price.refs.eventIds", Matchers.empty());
    return self();
  }

  @Step("Price research keeps the last estimate with the time it was made")
  public PriceResearchVerification hasLastEstimate(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.lastEstimate.estimatedAt", Matchers.notNullValue());
    response.body("data.lastEstimate.estimate.startPrice", Matchers.notNullValue());
    return self();
  }

  @Step("Last estimate starts at exactly {startPrice}")
  public PriceResearchVerification lastEstimateStartsAt(ValidatableResponse response, double startPrice) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    MatcherAssert.assertThat(response.extract().jsonPath().getDouble("data.lastEstimate.estimate.startPrice"),
        Matchers.closeTo(startPrice, PRICE_TOLERANCE));
    return self();
  }

  @Step("Last estimate has {confidence} confidence and was not proposed because of {hiddenReason}")
  public PriceResearchVerification lastEstimateIsHidden(ValidatableResponse response, String confidence,
      String hiddenReason) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.lastEstimate.estimate.confidence", Matchers.equalTo(confidence));
    response.body("data.lastEstimate.hiddenReason", Matchers.equalTo(hiddenReason));
    return self();
  }

  @Step("The refresh is accepted and runs in the background")
  public PriceResearchVerification isRefreshAccepted(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_ACCEPTED);
    response.body("success", Matchers.equalTo(true));
    response.body("data.run", Matchers.notNullValue());
    return self();
  }

  @Step("The last price research run ended {outcome} with every node done")
  public PriceResearchVerification lastRunSucceeded(ValidatableResponse response, String outcome) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.lastRun.outcome", Matchers.equalTo(outcome));
    response.body("data.lastRun.errorCode", Matchers.nullValue());
    response.body("data.lastRun.failedTiers", Matchers.empty());
    response.body("data.lastRun.nodes.values()", Matchers.everyItem(Matchers.equalTo("done")));
    return self();
  }

  @Step("The last price research run failed with {errorCode}, the tiers {failedTiers} did not answer")
  public PriceResearchVerification lastRunFailed(ValidatableResponse response, String errorCode,
      String... failedTiers) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.lastRun.outcome", Matchers.equalTo("failed"));
    response.body("data.lastRun.errorCode", Matchers.equalTo(errorCode));
    response.body("data.lastRun.failedTiers", Matchers.equalTo(List.of(failedTiers)));
    return self();
  }

  @Step("Price research holds auto anchors of the tiers {tiers}")
  public PriceResearchVerification hasAutoAnchorsOf(ValidatableResponse response, String... tiers) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.comparables.findAll { it.source == 'auto' }.tier", Matchers.hasItems(tiers));
    response.body("data.comparables.findAll { it.source != 'auto' }", Matchers.empty());
    return self();
  }

  // A failed run saves nothing: no comparables and no saved research row behind the run view.
  @Step("Price research stores no comparables and was never saved")
  public PriceResearchVerification storesNothing(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data.comparables", Matchers.empty());
    response.body("data.updatedAt", Matchers.nullValue());
    return self();
  }

  @Step("Save is refused because the price research changed since the form was opened")
  public PriceResearchVerification isStale(ValidatableResponse response) {
    failsWith(response, HttpStatus.SC_CONFLICT, CONFLICT);
    response.body("error.message", Matchers.equalTo(RESEARCH_CHANGED));
    return self();
  }

  @Step("Request is rejected as invalid")
  public PriceResearchVerification isInvalid(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_BAD_REQUEST, VALIDATION_ERROR);
  }

  @Step("The run history is empty")
  public PriceResearchVerification historyIsEmpty(ValidatableResponse history) {
    verifyResponseStatusCode(history, HttpStatus.SC_OK);
    history.body("data", Matchers.empty());
    return self();
  }

  @Step("The run history lists {count} runs")
  public PriceResearchVerification historyHasSize(ValidatableResponse history, int count) {
    verifyResponseStatusCode(history, HttpStatus.SC_OK);
    history.body("data", Matchers.hasSize(count));
    return self();
  }

  @Step("The run history lists at least {count} runs")
  public PriceResearchVerification historyHasAtLeast(ValidatableResponse history, int count) {
    verifyResponseStatusCode(history, HttpStatus.SC_OK);
    history.body("data.size()", Matchers.greaterThanOrEqualTo(count));
    return self();
  }

  @Step("The newest run was started by the trigger {trigger}")
  public PriceResearchVerification newestRunHasTrigger(ValidatableResponse history, String trigger) {
    verifyResponseStatusCode(history, HttpStatus.SC_OK);
    history.body("data[0].trigger", Matchers.equalTo(trigger));
    return self();
  }

  @Step("Product is not found")
  public PriceResearchVerification isNotFound(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_NOT_FOUND, NOT_FOUND);
  }

  @Step("Request is rejected as unauthenticated")
  public PriceResearchVerification isUnauthenticated(ValidatableResponse response) {
    return failsWith(response, HttpStatus.SC_UNAUTHORIZED, UNAUTHORIZED);
  }

  private PriceResearchVerification failsWith(ValidatableResponse response, int status, String code) {
    verifyResponseStatusCode(response, status);
    response.body("success", Matchers.equalTo(false));
    response.body("error.code", Matchers.equalTo(code));
    return self();
  }

  // Research is stored but no run has finished, so nothing is ready to price from.
  @Step("Price research carries the run state and reads as degraded without a successful run")
  public PriceResearchVerification hasRunStateAndIsDegraded(ValidatableResponse response) {
    verifyResponseStatusCode(response, HttpStatus.SC_OK);
    response.body("data", Matchers.allOf(Matchers.hasKey("run"), Matchers.hasKey("lastRun"),
        Matchers.hasKey("nextAutoAt"), Matchers.hasKey("readiness")));
    response.body("data.run", Matchers.nullValue());
    response.body("data.lastRun", Matchers.nullValue());
    response.body("data.readiness", Matchers.equalTo("degraded"));
    return this;
  }
}
