package example;

import dev.quokkify.service.ApiService;
import dev.quokkify.verification.BaseApiVerification;

import io.qameta.allure.Step;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

import static org.hamcrest.Matchers.equalTo;

/** HTTP smoke checks using the q4j REST Assured service and verification pattern. */
public class MarketDeskApiSmokeTest {

  private final MarketDeskApi api = new MarketDeskApi(
      System.getProperty("marketdesk.api.base-uri", "http://127.0.0.1:3000"));
  private final MarketDeskApiVerifier verifier = new MarketDeskApiVerifier();

  @Test(groups = "api")
  public void reportsLiveness() {
    ValidatableResponse response = api.get("/health");
    verifier.verifyResponseStatusCode(response, 200).hasStatus(response, "ok");
  }

  @Test(groups = "api")
  public void reportsDatabaseAndRedisReadiness() {
    ValidatableResponse response = api.get("/ready");
    verifier.verifyResponseStatusCode(response, 200)
        .hasStatus(response, "ready")
        .hasDatabaseConnection(response)
        .hasRedisConnection(response);
  }

  @Test(groups = "api")
  public void rejectsUnauthenticatedProductListingRequest() {
    ValidatableResponse response = api.get("/api/products");
    verifier.verifyResponseStatusCode(response, 401)
        .hasFailureFlag(response)
        .hasUnauthorizedError(response);
  }

  private static final class MarketDeskApi extends ApiService {

    private final String baseUri;

    private MarketDeskApi(String baseUri) {
      this.baseUri = baseUri;
    }

    private ValidatableResponse get(String path) {
      return get(
          RestAssured.given().spec(getRequestSpecification(baseUri, ContentType.JSON)), path);
    }
  }

  private static final class MarketDeskApiVerifier extends BaseApiVerification<MarketDeskApiVerifier> {

    @Override
    protected MarketDeskApiVerifier self() {
      return this;
    }

    @Step("Response status is {expectedStatus}")
    private MarketDeskApiVerifier hasStatus(ValidatableResponse response, String expectedStatus) {
      response.body("status", equalTo(expectedStatus));
      return self();
    }

    @Step("Database readiness is connected")
    private MarketDeskApiVerifier hasDatabaseConnection(ValidatableResponse response) {
      response.body("database", equalTo("connected"));
      return self();
    }

    @Step("Redis readiness is connected")
    private MarketDeskApiVerifier hasRedisConnection(ValidatableResponse response) {
      response.body("redis", equalTo("connected"));
      return self();
    }

    @Step("Response success flag is false")
    private MarketDeskApiVerifier hasFailureFlag(ValidatableResponse response) {
      response.body("success", equalTo(false));
      return self();
    }

    @Step("Response error code is UNAUTHORIZED")
    private MarketDeskApiVerifier hasUnauthorizedError(ValidatableResponse response) {
      response.body("error.code", equalTo("UNAUTHORIZED"));
      return self();
    }
  }
}
