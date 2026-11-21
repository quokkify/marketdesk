package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.marketdesk.service.MarketplaceService;
import dev.quokkify.marketdesk.verification.MarketplaceVerification;
import dev.quokkify.step.ApiSteps;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;

public class MarketplaceSteps extends ApiSteps<MarketplaceVerification> {

  private static final String OLX_ID_PATH = "data.find { it.key == 'olx' }.id";

  private final MarketplaceService service = new MarketplaceService();

  public MarketplaceSteps() {
    this.verification = new MarketplaceVerification();
  }

  // Takes the account, not its token: Allure stores every step parameter in the published report.
  @Step("Find the OLX marketplace of the account workspace")
  public String getOlxMarketplaceId(AccountPojo account) {
    return service.getMarketplaces(account.token())
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .path(OLX_ID_PATH);
  }

  @Step("Preview the OLX import without authentication")
  public ValidatableResponse previewImportUnauthenticated(String marketplaceId) {
    return service.previewImport(marketplaceId, MarketplaceImportRequestPojo.empty());
  }

  @Step("Preview the OLX import with {body}")
  public ValidatableResponse previewImport(AccountPojo account, String marketplaceId,
      MarketplaceImportRequestPojo body) {
    return service.previewImport(account.token(), marketplaceId, body);
  }

  @Step("Import OLX adverts with {body}")
  public ValidatableResponse importAdverts(AccountPojo account, String marketplaceId,
      MarketplaceImportRequestPojo body) {
    return service.importAdverts(account.token(), marketplaceId, body);
  }
}
