package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.page.ProductsPage;
import dev.quokkify.marketdesk.verification.ProductsPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductsPageSteps
    extends PageSteps<ProductsPageSteps, ProductsPageVerification, ProductsPage> {

  private static final String EXPANDED = "aria-expanded";

  public ProductsPageSteps() {
    this.page = new ProductsPage();
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

  @Step("Click the row of {productName}")
  public ProductsPageSteps clickRow(String productName) {
    page.row(productName).$("td:nth-child(4)").click();
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
