package dev.quokkify.marketdesk.test.api;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

// The API test stack runs OLX in stub mode, so a valid import request must stop at the sandbox guard; request
// validation runs before it and is checked here for both endpoints.
public class MarketplaceImportTest extends BaseTest {

  private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
  private static final String SANDBOX_MESSAGE = "Marketplace import is not available in sandbox mode";

  @DataProvider(name = "invalidPageSizes")
  public Object[][] invalidPageSizes() {
    return new Object[][] {{0}, {-1}, {1.5}, {101}};
  }

  @DataProvider(name = "malformedStatuses")
  public Object[][] malformedStatuses() {
    return new Object[][] {{List.of("active,removed")}, {List.of("")}, {List.of("../x")}, {"active"}};
  }

  @DataProvider(name = "malformedExternalListingIds")
  public Object[][] malformedExternalListingIds() {
    return new Object[][] {{"olx-1"}, {List.of(1)}, {List.of("")}};
  }

  @Test
  public void rejectsUnauthenticatedImportPreview() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    ValidatableResponse response = marketplaceSteps.previewImportUnauthenticated(marketplaceId);
    marketplaceSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_UNAUTHORIZED)
        .hasFailed(response)
        .hasErrorCode(response, "UNAUTHORIZED");
  }

  @Test(dataProvider = "invalidPageSizes")
  public void rejectsPageSizeOutsideOneToHundred(Object pageSize) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    MarketplaceImportRequestPojo body = MarketplaceImportRequestPojo.withPageSize(pageSize);
    verifyValidationError(marketplaceSteps.previewImport(account, marketplaceId, body));
    verifyValidationError(marketplaceSteps.importAdverts(account, marketplaceId, body));
  }

  @Test(dataProvider = "malformedStatuses")
  public void rejectsMalformedStatuses(Object statuses) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    verifyValidationError(marketplaceSteps.previewImport(account, marketplaceId,
        MarketplaceImportRequestPojo.withStatuses(statuses)));
  }

  @Test(dataProvider = "malformedExternalListingIds")
  public void rejectsMalformedExternalListingIds(Object externalListingIds) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    verifyValidationError(marketplaceSteps.importAdverts(account, marketplaceId,
        MarketplaceImportRequestPojo.withExternalListingIds(externalListingIds)));
  }

  @Test
  public void rejectsWorkspaceIdInImportBody() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    MarketplaceImportRequestPojo body = new MarketplaceImportRequestPojo(null, null, List.of("olx-1"), "other");
    verifyValidationError(marketplaceSteps.importAdverts(account, marketplaceId, body));
  }

  @Test
  public void refusesImportPreviewInSandboxMode() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    verifySandboxRefusal(marketplaceSteps.previewImport(account, marketplaceId,
        MarketplaceImportRequestPojo.withStatuses(List.of("active"))));
  }

  @Test
  public void refusesImportInSandboxMode() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    verifySandboxRefusal(marketplaceSteps.importAdverts(account, marketplaceId,
        MarketplaceImportRequestPojo.withExternalListingIds(List.of("olx-1"))));
  }

  private void verifyValidationError(ValidatableResponse response) {
    marketplaceSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_BAD_REQUEST)
        .hasFailed(response)
        .hasErrorCode(response, VALIDATION_ERROR);
  }

  private void verifySandboxRefusal(ValidatableResponse response) {
    marketplaceSteps.verify()
        .verifyResponseStatusCode(response, HttpStatus.SC_UNPROCESSABLE_ENTITY)
        .hasFailed(response)
        .hasErrorCode(response, "INVALID_STATE")
        .hasErrorMessage(response, SANDBOX_MESSAGE);
  }
}
