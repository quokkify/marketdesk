package example;

import dev.quokkify.service.ApiService;
import dev.quokkify.verification.ApiVerifier;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import org.testng.annotations.Test;

import static org.hamcrest.Matchers.equalTo;

/** HTTP smoke checks using the q4j REST Assured service and verification pattern. */
public class MarketDeskApiSmokeTest {

  private final MarketDeskApi api = new MarketDeskApi(
      System.getProperty("marketdesk.api.base-uri", "http://127.0.0.1:3000"));
  private final ApiVerifier verifier = new ApiVerifier();

  @Test(groups = "api")
  public void reportsLiveness() {
    ValidatableResponse response = api.get("/health");
    verifier.verifyResponseStatusCode(response, 200);
    response.body("status", equalTo("ok"));
  }

  @Test(groups = "api")
  public void reportsDatabaseAndRedisReadiness() {
    ValidatableResponse response = api.get("/ready");
    verifier.verifyResponseStatusCode(response, 200);
    response.body("status", equalTo("ready"))
        .body("database", equalTo("connected"))
        .body("redis", equalTo("connected"));
  }

  @Test(groups = "api")
  public void rejectsUnauthenticatedProductListingRequest() {
    ValidatableResponse response = api.get("/api/products");
    verifier.verifyResponseStatusCode(response, 401);
    response.body("success", equalTo(false))
        .body("error.code", equalTo("UNAUTHORIZED"));
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
}
