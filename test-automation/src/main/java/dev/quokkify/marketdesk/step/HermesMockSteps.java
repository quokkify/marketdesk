package dev.quokkify.marketdesk.step;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

import dev.quokkify.marketdesk.model.MockServerExpectationPojo;
import dev.quokkify.marketdesk.model.MockServerVerificationPojo;
import dev.quokkify.marketdesk.service.HermesMockService;
import dev.quokkify.marketdesk.verification.HermesMockVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

// Canned answers of the Hermes research profile, addressed per product name and graph node, so parallel tests
// never share an answer. Nothing here clears the mock: other tests' answers stay in place.
public class HermesMockSteps extends ApiSteps<HermesMockVerification> {

  private static final String ANSWERS = "hermes/research/";
  private static final String IDENTIFY = "identify";

  private final HermesMockService service = new HermesMockService();

  public HermesMockSteps() {
    this.verification = new HermesMockVerification();
  }

  @Step("The research node {node} answers {fixture} for {productName}")
  public void answer(String productName, String node, String fixture) {
    register(MockServerExpectationPojo.researchAnswer(node, productName, HttpStatus.SC_OK, read(fixture)));
  }

  // Expectations match in creation order, so a later answer for the same node takes over after this one.
  @Step("The research node {node} answers {fixture} once for {productName}")
  public void answerOnce(String productName, String node, String fixture) {
    register(MockServerExpectationPojo.researchAnswer(node, productName, HttpStatus.SC_OK, read(fixture)).once());
  }

  @Step("The research identifies {productName} as the recorded projector")
  public void answerIdentify(String productName) {
    answer(productName, IDENTIFY, "identify.json");
  }

  @Step("Every research tier answers with anchors for {productName}")
  public void answerAllTiers(String productName) {
    answer(productName, "sameModelUsed", "same-model-used.json");
    answer(productName, "lastNewPrice", "last-new-price.json");
    answer(productName, "substitutesNew", "substitutes-new.json");
    answer(productName, "substitutesUsed", "substitutes-used.json");
  }

  @Step("Ask the mock whether the research node {node} was called {count} times for {productName}")
  public ValidatableResponse checkCalls(String productName, String node, int count) {
    return service.verify(MockServerVerificationPojo.researchCalls(node, productName, count));
  }

  private void register(MockServerExpectationPojo expectation) {
    verification.isAnswerRegistered(service.createExpectation(expectation));
  }

  private static String read(String fixture) {
    try (InputStream stream = HermesMockSteps.class.getClassLoader().getResourceAsStream(ANSWERS + fixture)) {
      if (stream == null) {
        throw new IllegalArgumentException("No research answer fixture " + ANSWERS + fixture);
      }
      return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("Cannot read research answer fixture " + fixture, e);
    }
  }
}
