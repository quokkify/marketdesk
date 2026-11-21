package dev.quokkify.marketdesk.test.api;

import java.util.List;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import io.restassured.response.ValidatableResponse;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

// The API test stack runs OLX in stub mode, so a valid import request must stop at the sandbox guard; request
// validation runs before it and is checked here for both endpoints.
public class MarketplaceImportTest extends BaseTest {

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
    marketplaceSteps.verify().isUnauthenticated(response);
  }

  @Test(dataProvider = "invalidPageSizes")
  public void rejectsPageSizeOutsideOneToHundred(Object pageSize) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    MarketplaceImportRequestPojo body = MarketplaceImportRequestPojo.withPageSize(pageSize);
    marketplaceSteps.verify()
        .isValidationError(marketplaceSteps.previewImport(account, marketplaceId, body))
        .isValidationError(marketplaceSteps.importAdverts(account, marketplaceId, body));
  }

  @Test(dataProvider = "malformedStatuses")
  public void rejectsMalformedStatuses(Object statuses) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    MarketplaceImportRequestPojo body = MarketplaceImportRequestPojo.withStatuses(statuses);
    marketplaceSteps.verify()
        .isValidationError(marketplaceSteps.previewImport(account, marketplaceId, body))
        .isValidationError(marketplaceSteps.importAdverts(account, marketplaceId, body));
  }

  @Test(dataProvider = "malformedExternalListingIds")
  public void rejectsMalformedExternalListingIds(Object externalListingIds) {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    marketplaceSteps.verify().isValidationError(marketplaceSteps.importAdverts(account, marketplaceId,
        MarketplaceImportRequestPojo.withExternalListingIds(externalListingIds)));
  }

  @Test
  public void rejectsWorkspaceIdInImportBody() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    MarketplaceImportRequestPojo body = new MarketplaceImportRequestPojo(null, null, List.of("olx-1"), "other");
    marketplaceSteps.verify().isValidationError(marketplaceSteps.importAdverts(account, marketplaceId, body));
  }

  @Test
  public void refusesImportPreviewInSandboxMode() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    marketplaceSteps.verify().isSandboxRefusal(marketplaceSteps.previewImport(account, marketplaceId,
        MarketplaceImportRequestPojo.withStatuses(List.of("active"))));
  }

  @Test
  public void refusesImportInSandboxMode() {
    AccountPojo account = authSteps.registerNewAccount();
    String marketplaceId = marketplaceSteps.getOlxMarketplaceId(account);
    marketplaceSteps.verify().isSandboxRefusal(marketplaceSteps.importAdverts(account, marketplaceId,
        MarketplaceImportRequestPojo.withStatuses(List.of("active"))));
  }
}
