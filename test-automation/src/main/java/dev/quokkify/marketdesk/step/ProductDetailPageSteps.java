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

  @Step("Replace the draft reply to the buyer message {buyerText} with {reply} and send it")
  public ProductDetailPageSteps editAndSendDraft(String buyerText, String reply) {
    page.replaceReplyText(buyerText, reply);
    page.sendButton(buyerText).shouldBe(Condition.enabled).click();
    return this;
  }
}
