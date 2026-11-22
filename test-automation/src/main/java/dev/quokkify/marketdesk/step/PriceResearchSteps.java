package dev.quokkify.marketdesk.step;

import java.util.Map;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;
import dev.quokkify.marketdesk.service.PriceResearchService;
import dev.quokkify.marketdesk.service.ProductService;
import dev.quokkify.marketdesk.verification.PriceResearchVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class PriceResearchSteps extends ApiSteps<PriceResearchVerification> {

  private static final String DATA_ID = "data.id";

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

  @Step("Run the AI analysis of product {productId}")
  public ValidatableResponse runProductAnalysis(AccountPojo account, String productId) {
    return service.runProductAnalysis(account.token(), productId);
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

  @Step("Refresh the price anchor ladder without authentication")
  public ValidatableResponse refreshPriceResearchUnauthenticated(String productId) {
    return service.refreshPriceResearch(productId);
  }
}
