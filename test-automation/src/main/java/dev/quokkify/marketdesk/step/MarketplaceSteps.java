package dev.quokkify.marketdesk.step;

import java.time.Duration;
import java.time.Instant;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.marketdesk.model.OlxQuotaRequestPojo;
import dev.quokkify.marketdesk.service.MarketplaceService;
import dev.quokkify.marketdesk.verification.MarketplaceVerification;
import dev.quokkify.step.ApiSteps;
import dev.quokkify.util.Waiter;

import io.qameta.allure.Step;
import io.restassured.response.ValidatableResponse;
import org.apache.http.HttpStatus;
import org.hamcrest.Matchers;

public class MarketplaceSteps extends ApiSteps<MarketplaceVerification> {

  private static final String OLX_ID_PATH = "data.find { it.key == 'olx' }.id";
  private static final String OLX_LAST_SYNC_PATH = "data.find { it.key == 'olx' }.lastSyncAt";
  private static final Duration SYNC_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration POLL_INTERVAL = Duration.ofMillis(500);

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

  // In stub mode connect attaches the labelled sandbox OLX account at once.
  @Step("Connect the sandbox OLX account")
  public void connectSandboxOlx(AccountPojo account) {
    service.connect(account.token(), getOlxMarketplaceId(account)).statusCode(HttpStatus.SC_OK);
  }

  @Step("Use up the free OLX publications of subcategory {subcategoryId}")
  public void exhaustOlxQuota(AccountPojo account, String subcategoryId) {
    service.setQuota(account.token(), getOlxMarketplaceId(account),
        OlxQuotaRequestPojo.exhausted(subcategoryId, Instant.now())).statusCode(HttpStatus.SC_OK);
  }

  @Step("Start a sync of the OLX marketplace")
  public void syncOlx(AccountPojo account) {
    service.sync(account.token(), getOlxMarketplaceId(account)).statusCode(HttpStatus.SC_ACCEPTED);
  }

  // Waits for a finished sync, so a later sync can be told apart by its newer time.
  @Step("Wait until the OLX marketplace has synced and read when")
  public String awaitOlxLastSyncAt(AccountPojo account) {
    return Waiter.awaitCondition(() -> readOlxLastSyncAt(account), Matchers.notNullValue(),
        "the OLX marketplace has synced", SYNC_TIMEOUT, POLL_INTERVAL);
  }

  @Step("Start a sync of the OLX marketplace and wait until it finishes after {previousSyncAt}")
  public void resyncOlx(AccountPojo account, String previousSyncAt) {
    syncOlx(account);
    Waiter.awaitCondition(() -> readOlxLastSyncAt(account), Matchers.not(Matchers.equalTo(previousSyncAt)),
        "the OLX marketplace synced again", SYNC_TIMEOUT, POLL_INTERVAL);
  }

  private String readOlxLastSyncAt(AccountPojo account) {
    return service.getMarketplaces(account.token())
        .statusCode(HttpStatus.SC_OK)
        .extract()
        .path(OLX_LAST_SYNC_PATH);
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
