package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.verification.ProductDetailPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductDetailPageSteps
    extends PageSteps<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  public ProductDetailPageSteps() {
    this.page = new ProductDetailPage();
    this.verification = new ProductDetailPageVerification(this, page);
  }

  @Step("Open the product page")
  public ProductDetailPageSteps openProductPage(ProductListingPojo productListing) {
    page.open(productListing.productId());
    return this;
  }

  @Step("Suggest improvements")
  public ProductDetailPageSteps suggestImprovements() {
    page.suggestImprovementsButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Open the revival dialog")
  public ProductDetailPageSteps openRevivalDialog() {
    page.reviveButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Open the condition list in the revival dialog")
  public ProductDetailPageSteps openRevivalConditions() {
    page.revivalConditionSelect().shouldBe(Condition.visible).click();
    return this;
  }

  @Step("Choose the condition {condition} in the revival dialog")
  public ProductDetailPageSteps chooseRevivalCondition(String condition) {
    if (!page.conditionOption(condition).isDisplayed()) {
      page.revivalConditionSelect().shouldBe(Condition.visible).click();
    }
    page.conditionOption(condition).shouldBe(Condition.visible).click();
    return this;
  }
}
