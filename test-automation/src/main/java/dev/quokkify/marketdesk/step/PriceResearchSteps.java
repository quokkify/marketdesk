package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.PriceResearchService;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.PriceResearchVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class PriceResearchSteps extends ApiSteps<PriceResearchVerification> {

  private static final String DATA_ID = "data.id";
  private static final String ALLEGRO_OFFER = "https://allegro.pl/oferta/projektor-";
  private static final String SEEN_AT = "2026-11-20";
  private static final Duration RUN_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);

  private final PriceResearchService service = new PriceResearchService();
  private final ProductService productService = new ProductService();

  public PriceResearchSteps() {
    this.verification = new PriceResearchVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Create a product without a listing")
  public String createProduct(AccountPojo account) {
    return productService.createProduct(account.token(), ProductRequestPojo.sample())
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path(DATA_ID);
  }

  @Step("Get price research of product {productId}")
  public ValidatableResponse getPriceResearch(AccountPojo account, String productId) {
    return service.getPriceResearch(account.token(), productId);
  }

  @Step("Save price research of product {productId}")
  public ValidatableResponse savePriceResearch(AccountPojo account, String productId, PriceResearchPojo research) {
    return service.putPriceResearch(account.token(), productId, research);
  }

  @Step("Save price research of product {productId} with an extra field")
  public ValidatableResponse savePriceResearch(AccountPojo account, String productId, Map<String, Object> body) {
    return service.putPriceResearch(account.token(), productId, body);
  }

  @Step("Save price research of product {productId} built from the version saved at {baseUpdatedAt}")
  public ValidatableResponse savePriceResearchFrom(AccountPojo account, String productId, PriceResearchPojo research,
      String baseUpdatedAt) {
    return service.putPriceResearch(account.token(), productId, research.withExtraField("baseUpdatedAt", baseUpdatedAt));
  }

  @Step("Read when the price research of product {productId} was last changed")
  public String priceResearchUpdatedAt(AccountPojo account, String productId) {
    return service.getPriceResearch(account.token(), productId)
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .path("data.updatedAt");
  }

  @Step("Get price research without authentication")
  public ValidatableResponse getPriceResearchUnauthenticated(String productId) {
    return service.getPriceResearch(productId);
  }

  @Step("Save price research without authentication")
  public ValidatableResponse savePriceResearchUnauthenticated(String productId, PriceResearchPojo research) {
    return service.putPriceResearch(productId, research);
  }

  @Step("Refresh the price anchor ladder of product {productId}")
  public ValidatableResponse refreshPriceResearch(AccountPojo account, String productId) {
    return service.refreshPriceResearch(account.token(), productId);
  }

  // The refresh answers 202 and the research runs in a queue job; the run is over once none is active.
  @Step("Wait until the price research run of product {productId} ends")
  public ValidatableResponse awaitResearchRun(AccountPojo account, String productId) {
    Waiter.awaitCondition(() -> hasRunEnded(service.getPriceResearch(account.token(), productId)),
        "the price research run has ended", RUN_TIMEOUT, POLL_INTERVAL);
    return service.getPriceResearch(account.token(), productId);
  }

  @Step("Get the market search run history of product {productId}")
  public ValidatableResponse getRunHistory(AccountPojo account, String productId) {
    return service.getRunHistory(account.token(), productId);
  }

  @Step("Get the market search run history of product {productId} with the limit {limit}")
  public ValidatableResponse getRunHistory(AccountPojo account, String productId, String limit) {
    return service.getRunHistory(account.token(), productId, limit);
  }

  @Step("Read the id of the newest market search run")
  public String newestRunId(ValidatableResponse history) {
    return history.extract().path("data[0].id");
  }

  @Step("Refresh the price anchor ladder without authentication")
  public ValidatableResponse refreshPriceResearchUnauthenticated(String productId) {
    return service.refreshPriceResearch(productId);
  }

  @Step("Save the auto comparables of product {productId}")
  public ValidatableResponse saveAutoComparables(AccountPojo account, String productId, String tier, Double... prices) {
    List<PriceResearchPojo.Comparable> rows = IntStream.range(0, prices.length)
        .mapToObj(i -> new PriceResearchPojo.Comparable(prices[i], "Projector " + i,
            ALLEGRO_OFFER + i, "auto", tier, SEEN_AT))
        .toList();
    return service.putPriceResearch(account.token(), productId,
        new PriceResearchPojo(null, null, null, null, rows));
  }

  @Step("Save class-checked auto comparables of product {productId}")
  public ValidatableResponse saveClassCheckedComparables(AccountPojo account, String productId, String tier,
      Double... prices) {
    List<PriceResearchPojo.ClassAttribute> attributes = List.of(
        new PriceResearchPojo.ClassAttribute("native resolution", "1280x720", null, "equal"),
        new PriceResearchPojo.ClassAttribute("brightness", 200, "ANSI lumens", "ratio"));
    List<PriceResearchPojo.Comparable> rows = IntStream.range(0, prices.length)
        .mapToObj(i -> new PriceResearchPojo.Comparable(prices[i], "Projector " + i,
            ALLEGRO_OFFER + i, "auto", tier, SEEN_AT, attributes, true))
        .toList();
    return service.putPriceResearch(account.token(), productId,
        new PriceResearchPojo(null, null, null, null, rows));
  }

  @Step("Save a checked substitute with class attributes for product {productId}")
  public ValidatableResponse saveClassCheckedSubstitute(AccountPojo account, String productId) {
    PriceResearchPojo.Comparable row = new PriceResearchPojo.Comparable(190.0, "Projector 720p", ALLEGRO_OFFER + "720",
        "auto", "substitute_used", SEEN_AT,
        List.of(new PriceResearchPojo.ClassAttribute("resolution", "720p", null, "equal"),
            new PriceResearchPojo.ClassAttribute("brightness", 200, "ANSI lm", "ratio")),
        true);
    return service.putPriceResearch(account.token(), productId,
        new PriceResearchPojo(null, null, null, null, List.of(row)));
  }

  private static boolean hasRunEnded(ValidatableResponse view) {
    return view.extract().path("data") != null
        && view.extract().path("data.run") == null
        && view.extract().path("data.lastRun") != null;
  }
}
