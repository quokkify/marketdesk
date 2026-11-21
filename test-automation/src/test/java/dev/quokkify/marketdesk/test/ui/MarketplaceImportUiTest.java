package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.model.AccountPojo;

import org.testng.annotations.Test;

// Regression guard: the test stack runs OLX in stub mode, and a sandbox account has no OLX adverts to read, so
// a connected sandbox OLX must not offer the import.
public class MarketplaceImportUiTest extends BaseUiTest {

  @Test
  public void connectedSandboxOlxDoesNotOfferImport() {
    AccountPojo account = authSteps.registerNewAccount();
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    marketplacesPageSteps
        .openMarketplacesPage()
        .connectSandboxOlx()
        .verify()
        .olxIsConnected()
        .importFromOlxIsNotOffered();
  }
}
