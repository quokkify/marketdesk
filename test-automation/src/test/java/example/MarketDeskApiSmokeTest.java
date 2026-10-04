package example;

import io.restassured.response.Response;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/** HTTP smoke and contract checks against a running MarketDesk instance. */
public class MarketDeskApiSmokeTest {

  private String baseUri() {
    return System.getProperty("marketdesk.api.base-uri", "http://127.0.0.1:3000");
  }

  @Test(groups = "api")
  public void reportsLiveness() {
    given()
        .baseUri(baseUri())
    .when()
        .get("/health")
    .then()
        .statusCode(200)
        .body("status", equalTo("ok"));
  }

  @Test(groups = "api")
  public void reportsDatabaseAndRedisReadiness() {
    given()
        .baseUri(baseUri())
    .when()
        .get("/ready")
    .then()
        .statusCode(200)
        .body("status", equalTo("ready"))
        .body("database", equalTo("connected"))
        .body("redis", equalTo("connected"));
  }

  @Test(groups = "api")
  public void rejectsUnauthenticatedProductListingRequest() {
    Response response = given()
        .baseUri(baseUri())
        .when()
        .get("/api/products");

    response.then()
          .log()
          .ifValidationFails()
          .statusCode(401)
          .body("success", equalTo(false))
          .body("error.code", equalTo("UNAUTHORIZED"));
  }
}
