package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.page.ProductsPage;
import dev.quokkify.marketdesk.verification.ProductsPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import io.qameta.allure.Step;

public class ProductsPageSteps
    extends PageSteps<ProductsPageSteps, ProductsPageVerification, ProductsPage> {

  private static final String EXPANDED = "aria-expanded";
  private static final String PRODUCT_PHOTO = "images/product-photo.png";
  private static final String DESCRIPTION =
      "Mirrorless camera with lens, original battery and carrying bag. Fully working, with minor signs of use.";
  private static final String SELLING_PRICE = "1050";
  private static final String CAMERAS_QUERY = "camera";
  private static final String SANDBOX_CAMERAS_PATH = "Electronics > Cameras";

  public ProductsPageSteps() {
    this.page = Selenide.page(new ProductsPage());
    this.verification = new ProductsPageVerification(this, page);
  }

  @Step("Open the products catalogue")
  public ProductsPageSteps openProductsPage() {
    page.open();
    return this;
  }

  @Step("Open the {label} tab")
  public ProductsPageSteps openTab(String label) {
    page.tab(label).shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Open the New product dialog")
  public ProductsPageSteps openNewProductDialog() {
    page.newProductButton().shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Close the New product dialog")
  public ProductsPageSteps closeNewProductDialog() {
    page.closeDialogButton().shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Upload a product photo")
  public ProductsPageSteps uploadProductPhoto() {
    page.photoInput().uploadFromClasspath(PRODUCT_PHOTO);
    return this;
  }

  @Step("Continue to the review step")
  public ProductsPageSteps continueToReview() {
    page.continueButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Fill the review step for {name}")
  public ProductsPageSteps fillReview(String name) {
    page.nameField().shouldBe(Condition.visible).setValue(name);
    page.descriptionField().setValue(DESCRIPTION);
    page.sellingPriceField().setValue(SELLING_PRICE);
    return this;
  }

  @Step("Choose the sandbox OLX category Electronics > Cameras")
  public ProductsPageSteps chooseSandboxCamerasCategory() {
    page.olxCategoryField().shouldBe(Condition.visible).setValue(CAMERAS_QUERY);
    page.olxCategoryResult(SANDBOX_CAMERAS_PATH).shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Fill the New product wizard for {name} in the sandbox Cameras category")
  public ProductsPageSteps fillWizardForSandboxCameras(String name) {
    return uploadProductPhoto()
        .continueToReview()
        .fillReview(name)
        .chooseSandboxCamerasCategory();
  }

  @Step("Publish to OLX")
  public ProductsPageSteps publishToOlx() {
    page.publishToOlxButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Press Publish to OLX twice at once")
  public ProductsPageSteps publishToOlxTwiceAtOnce() {
    page.clickTwiceAtOnce(page.publishToOlxButton().shouldBe(Condition.enabled));
    return this;
  }

  @Step("Resize the browser window to {width}x{height}")
  public ProductsPageSteps useWindowSize(int width, int height) {
    page.resizeWindow(width, height);
    return this;
  }

  @Step("Open the filters panel")
  public ProductsPageSteps openFilters() {
    page.filtersButton().shouldBe(Condition.visible).click();
    page.filtersButton().shouldHave(Condition.attribute(EXPANDED, "true"));
    page.filtersPanel().shouldBe(Condition.visible);
    // Measure only after the Collapse transition ends; mid-animation the card overflows its wrapper.
    page.filtersFullyOpen().shouldBe(Condition.exist);
    return this;
  }

  @Step("Analyze {productName} with AI from its row")
  public ProductsPageSteps analyzeRow(String productName) {
    page.analyzeButton(productName).shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Analyze {productName} with AI from its row menu")
  public ProductsPageSteps analyzeFromRowMenu(String productName) {
    page.rowActionsButton(productName).shouldBe(Condition.visible).click();
    page.analyzeMenuItem().shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Ask why {productName} gets no response from its row")
  public ProductsPageSteps askWhyNoResponse(String productName) {
    page.responseAskButton(productName).shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Click the row of {productName}")
  public ProductsPageSteps clickRow(String productName) {
    page.priceCell(productName).click();
    return this;
  }

  @Step("Approve the first pending suggestion under {productName}")
  public ProductsPageSteps approveFirstSuggestion(String productName) {
    page.reviewRegion().shouldBe(Condition.visible);
    page.approveButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Dismiss the first pending suggestion under {productName}")
  public ProductsPageSteps dismissFirstSuggestion(String productName) {
    page.reviewRegion().shouldBe(Condition.visible);
    page.dismissButton().shouldBe(Condition.enabled).click();
    return this;
  }
}
