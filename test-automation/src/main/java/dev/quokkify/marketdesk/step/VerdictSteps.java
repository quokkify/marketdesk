package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.service.VerdictService;
import dev.quokkify.marketdesk.verification.VerdictVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class VerdictSteps extends ApiSteps<VerdictVerification> {

  private static final Duration VERDICT_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration POLL_INTERVAL = Duration.ofSeconds(1);

  private final VerdictService service = new VerdictService();
  private final ProductService productService = new ProductService();

  public VerdictSteps() {
    this.verification = new VerdictVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Create a product without a listing")
  public String createProduct(AccountPojo account, ProductRequestPojo product) {
    return productService.createProduct(account.token(), product)
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .path("data.id");
  }

  @Step("Analyze product {productId}")
  public ValidatableResponse runAnalyze(AccountPojo account, String productId) {
    return service.runAnalyze(account.token(), productId);
  }

  // Analyze answers 202 with the run; the checks and their suggestions exist once the run has ended.
  @Step("Analyze product {productId} and wait for the sale verdict")
  public ValidatableResponse analyzeAndAwait(AccountPojo account, String productId) {
    service.runAnalyze(account.token(), productId).statusCode(HttpStatus.SC_ACCEPTED);
    return awaitVerdict(account, productId);
  }

  @Step("Read the suggestion ids of the {check} check")
  public List<String> eventIds(ValidatableResponse view, String check) {
    return view.extract().jsonPath().getList("data.latest.checks." + check + ".refs.eventIds", String.class);
  }

  @Step("Analyze product {productId} without authentication")
  public ValidatableResponse runAnalyzeUnauthenticated(String productId) {
    return service.runAnalyze(productId);
  }

  @Step("Run the checks {scope} of product {productId}")
  public ValidatableResponse runScope(AccountPojo account, String productId, List<String> scope) {
    return service.runScope(account.token(), productId, scope);
  }

  @Step("Get the sale verdict of product {productId}")
  public ValidatableResponse getVerdict(AccountPojo account, String productId) {
    return service.getVerdict(account.token(), productId);
  }

  @Step("Get the sale verdict without authentication")
  public ValidatableResponse getVerdictUnauthenticated(String productId) {
    return service.getVerdict(productId);
  }

  // A run is over when nothing is active; it left a completed verdict, or the last run failed.
  @Step("Wait until the sale verdict run of product {productId} ends")
  public ValidatableResponse awaitVerdict(AccountPojo account, String productId) {
    Waiter.awaitCondition(() -> hasEnded(service.getVerdict(account.token(), productId)),
        "the sale verdict run has ended", VERDICT_TIMEOUT, POLL_INTERVAL);
    return service.getVerdict(account.token(), productId);
  }

  @Step("Wait until the {check} check of product {productId} is newer than {before}")
  public ValidatableResponse awaitCheckLater(AccountPojo account, String productId, String check, String before) {
    Waiter.awaitCondition(() -> {
      String now = checkedAt(service.getVerdict(account.token(), productId), check);
      return now != null && java.time.Instant.parse(now).isAfter(java.time.Instant.parse(before));
    }, "the " + check + " check is newer", VERDICT_TIMEOUT, POLL_INTERVAL);
    return awaitVerdict(account, productId);
  }

  @Step("Recheck listing {listingId} of product {productId}")
  public ValidatableResponse recheck(AccountPojo account, String productId, String listingId) {
    return service.recheck(account.token(), productId, listingId);
  }

  @Step("Ask for improvements of product {productId}")
  public ValidatableResponse requestImprovements(AccountPojo account, String productId) {
    return service.improvements(account.token(), productId);
  }

  // Products and listings take their currency from the workspace.
  @Step("Set the workspace currency to {currency}")
  public void setWorkspaceCurrency(AccountPojo account, String currency) {
    service.setWorkspaceCurrency(account.token(), account.workspaceId(), currency).statusCode(HttpStatus.SC_OK);
  }

  @Step("Turn the listing SEO agent on")
  public void enableListingSeo(AccountPojo account) {
    service.enableListingSeo(account.token()).statusCode(HttpStatus.SC_OK);
  }

  @Step("Get products as an authenticated user")
  public ValidatableResponse getProducts(AccountPojo account) {
    return productService.getProducts(account.token());
  }

  @Step("Read the run id")
  public String runId(ValidatableResponse response) {
    return response.extract().path("data.id");
  }

  @Step("Read when the run was created")
  public String createdAt(ValidatableResponse response) {
    return response.extract().path("data.createdAt");
  }

  @Step("Read when the {check} check was made")
  public String checkedAt(ValidatableResponse view, String check) {
    return view.extract().path("data.latest.checks." + check + ".checkedAt");
  }

  private static boolean hasEnded(ValidatableResponse view) {
    boolean idle = view.extract().path("data.active") == null;
    boolean settled = view.extract().path("data.latest") != null
        || Boolean.TRUE.equals(view.extract().path("data.lastFailed"));
    return idle && settled;
  }
}
