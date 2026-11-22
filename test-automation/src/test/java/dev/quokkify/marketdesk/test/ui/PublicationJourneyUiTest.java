package dev.quokkify.marketdesk.test.ui;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.model.ProductRequestPojo;

import org.testng.annotations.Test;

public class PublicationJourneyUiTest extends BaseUiTest {

  private static final String PRODUCT_NAME = ProductRequestPojo.sample().name();
  private static final String SANDBOX_CAMERAS_ID = "1001";
  private static final String DRAFT = "draft";

  @Test
  public void creationEntryAndReviewOnlyAssistanceAreVisible() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    listingSteps.setSandboxOlxCategory(account, productListing.listingId());
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
    productsPageSteps
        .openNewProductDialog()
        .verify()
        .newProductDialogIsShown()
        .backToSteps()
        .closeNewProductDialog()
        .verify()
        .newProductDialogIsClosed();
    productDetailPageSteps
        .openProductPage(productListing)
        .verify()
        .showsPublicationReadinessCheck()
        .backToSteps()
        .suggestImprovements()
        .verify()
        .showsSuggestionsForReviewOnly(PRODUCT_NAME)
        .backToSteps()
        .openPublicationDialog()
        .verify()
        .showsPublicationConfirmation();
  }

  @Test
  public void newProductIsQueuedFromTheWizard() {
    String name = uniqueName();
    AccountPojo account = signInWithSandboxOlx();
    productsPageSteps
        .openNewProductDialog()
        .uploadProductPhoto()
        .continueToReview()
        .verify()
        .reviewStepIsShown()
        .backToSteps()
        .fillReview(name)
        .chooseSandboxCamerasCategory()
        .verify()
        .publishToOlxIsEnabled()
        .backToSteps()
        .publishToOlx();
    productDetailPageSteps
        .verify()
        .showsPublicationQueued();
    productSteps.verify().hasExactlyOneProductNamed(productSteps.getProducts(account), name);
    ProductListingPojo created = productSteps.findProductListing(account, name);
    listingSteps.awaitListingLive(account, created.listingId());
    listingSteps.verify().hasOlxCategory(listingSteps.getListing(account, created.listingId()), SANDBOX_CAMERAS_ID);
  }

  @Test
  public void exhaustedQuotaAsksToConfirmTheOlxFee() {
    String name = uniqueName();
    AccountPojo account = registerWithSandboxOlx();
    marketplaceSteps.exhaustOlxQuota(account, SANDBOX_CAMERAS_ID);
    signIn(account);
    productsPageSteps
        .openNewProductDialog()
        .fillWizardForSandboxCameras(name)
        .publishToOlx();
    productDetailPageSteps
        .verify()
        .showsOlxFeeConfirmation();
    ProductListingPojo created = productSteps.findProductListing(account, name);
    listingSteps.verify().hasStatus(listingSteps.getListing(account, created.listingId()), DRAFT);
  }

  private AccountPojo signInWithSandboxOlx() {
    AccountPojo account = registerWithSandboxOlx();
    signIn(account);
    return account;
  }

  private AccountPojo registerWithSandboxOlx() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    return account;
  }

  private void signIn(AccountPojo account) {
    loginPageSteps
        .openLoginPage()
        .signIn(account.email(), account.password())
        .verify()
        .productsCatalogueIsShown();
  }

  private static String uniqueName() {
    return "Mirrorless camera kit " + UUID.randomUUID().toString().substring(0, 8);
  }
}
