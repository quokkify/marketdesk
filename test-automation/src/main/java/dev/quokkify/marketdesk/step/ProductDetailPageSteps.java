package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.verification.ProductDetailPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import io.qameta.allure.Step;
import org.openqa.selenium.Keys;

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

  @Step("Enter the retail price {price} {currency} from {source} and save it")
  public ProductDetailPageSteps saveRetailAnchor(String price, String currency, String source) {
    page.retailPriceInput().shouldBe(Condition.visible).setValue(price);
    page.retailCurrencyInput().sendKeys(Keys.chord(Keys.CONTROL, "a"), currency);
    page.retailSourceInput().setValue(source);
    page.savePriceResearchButton().shouldBe(Condition.enabled).click();
    page.priceResearchSavedNote().shouldBe(Condition.visible);
    return this;
  }

  @Step("Find prices")
  public ProductDetailPageSteps findPrices() {
    page.findPricesButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Reload the product page")
  public ProductDetailPageSteps reloadPage() {
    Selenide.refresh();
    return this;
  }
}
