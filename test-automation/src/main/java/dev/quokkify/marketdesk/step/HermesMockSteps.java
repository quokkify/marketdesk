package dev.quokkify.marketdesk.step;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

import dev.quokkify.marketdesk.model.ChatCompletionPojo;
import dev.quokkify.marketdesk.model.MockServerExpectationPojo;
import dev.quokkify.marketdesk.model.MockServerVerificationPojo;
import dev.quokkify.marketdesk.model.OlxAdvertPagePojo;
import dev.quokkify.marketdesk.model.OlxSearchPagePojo;
import dev.quokkify.marketdesk.service.HermesMockService;
import dev.quokkify.marketdesk.verification.HermesMockVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

// Canned answers of the stand's MockServer: the Hermes research profile, addressed per product name and graph node;
// the buyer-queries and parcel size calls of the main profile, addressed per product name; synthetic OLX search pages,
// addressed per query; and synthetic OLX advert pages, addressed per advert slug. Each test uses its own product name,
// query and slug, so parallel tests never share an answer. Nothing here clears the mock: other tests' answers stay in
// place.
public class HermesMockSteps extends ApiSteps<HermesMockVerification> {

  private static final String ANSWERS = "hermes/research/";
  private static final String IDENTIFY = "identify";
  // The search the listing response tests read: 966 adverts on 25 pages of 40 organic cards.
  private static final int SEARCH_TOTAL = 966;
  private static final int SEARCH_PAGES = 25;
  private static final int CARDS_PER_PAGE = 40;
  private static final int OTHERS_BEFORE_OWN_ON_PAGE_2 = 16;
  private static final long FIRST_OTHER_ADVERT_ID = 100_000_001L;
  private static final String NO_PAGE = "";
  private static final int FIRST_ADVERT_PAGE = 0;
  private static final int SWITCHED_ADVERT_PAGE = 1;

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

  @Step("Hermes proposes the buyer query {query} for {productName}")
  public void answerQueries(String productName, String query) {
    register(MockServerExpectationPojo.queriesAnswer(productName, HttpStatus.SC_OK,
        ChatCompletionPojo.queries(List.of(query)).toJson()));
  }

  // Page 1: 40 organic cards of other sellers. Page 2: 16 more, then the advert itself, the 57th organic card.
  // The app stops paging once it found the advert, so it reads exactly these two pages.
  @Step("The OLX search for {query} shows advert {advertId} as the 17th organic card of page 2")
  public void showAdvertOnSecondSearchPage(String query, String advertId) {
    register(MockServerExpectationPojo.searchPageAnswer(query, 2, HttpStatus.SC_OK,
        OlxSearchPagePojo.pageEndingWith(SEARCH_TOTAL, SEARCH_PAGES, FIRST_OTHER_ADVERT_ID + CARDS_PER_PAGE,
            OTHERS_BEFORE_OWN_ON_PAGE_2, advertId).toHtml()));
    register(MockServerExpectationPojo.searchPageAnswer(query, 1, HttpStatus.SC_OK,
        OlxSearchPagePojo.page(SEARCH_TOTAL, SEARCH_PAGES,
            OlxSearchPagePojo.otherAdverts(FIRST_OTHER_ADVERT_ID, CARDS_PER_PAGE)).toHtml()));
  }

  @Step("Hermes proposes {query} for {productName} and the OLX search shows advert {advertId} at organic position 57")
  public void answerSearchWithAdvertDeepInResults(String productName, String query, String advertId) {
    answerQueries(productName, query);
    showAdvertOnSecondSearchPage(query, advertId);
  }

  @Step("Every OLX search page for {query} answers {statusCode}")
  public void failSearch(String query, int statusCode) {
    register(MockServerExpectationPojo.searchPageAnswer(query, 1, statusCode, NO_PAGE));
  }

  @Step("Ask the mock whether the buyer-queries call was made {count} times for {productName}")
  public ValidatableResponse checkQueriesCalls(String productName, int count) {
    return service.verify(MockServerVerificationPojo.queriesCalls(productName, count));
  }

  @Step("Ask the mock whether the OLX search for {query} was requested {count} times")
  public ValidatableResponse checkSearchRequests(String query, int count) {
    return service.verify(MockServerVerificationPojo.searchRequests(query, count));
  }

  @Step("Hermes picks the parcel size {size} for {productName}")
  public void answerParcelSize(String productName, String size) {
    register(MockServerExpectationPojo.parcelSizeAnswer(productName, HttpStatus.SC_OK,
        ChatCompletionPojo.parcelSize(size).toJson()));
  }

  @Step("The OLX advert page {slug} shows the delivery mode {mode}")
  public void showAdvertPage(String slug, String mode) {
    register(MockServerExpectationPojo.advertPageAnswer(OlxAdvertPagePojo.advertPath(slug), HttpStatus.SC_OK,
        OlxAdvertPagePojo.withDeliveryMode(mode).toHtml(), FIRST_ADVERT_PAGE));
  }

  // The new answer has a higher priority, so it replaces the one showAdvertPage registered.
  @Step("The OLX advert page {slug} now shows the delivery mode {mode}")
  public void switchAdvertPage(String slug, String mode) {
    register(MockServerExpectationPojo.advertPageAnswer(OlxAdvertPagePojo.advertPath(slug), HttpStatus.SC_OK,
        OlxAdvertPagePojo.withDeliveryMode(mode).toHtml(), SWITCHED_ADVERT_PAGE));
  }

  @Step("The OLX advert page {slug} answers {statusCode}")
  public void failAdvertPage(String slug, int statusCode) {
    register(MockServerExpectationPojo.advertPageAnswer(OlxAdvertPagePojo.advertPath(slug), statusCode, NO_PAGE,
        FIRST_ADVERT_PAGE));
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
