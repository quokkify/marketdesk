package dev.quokkify.marketdesk.step;

import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.verification.ProductDetailPageVerification;
import dev.quokkify.model.PageSteps;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import io.qameta.allure.Step;
import org.openqa.selenium.Keys;
import org.openqa.selenium.interactions.WheelInput;

public class ProductDetailPageSteps
    extends PageSteps<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  private static final String SEARCHING = "Searching…";
  private static final int WHEEL_TICKS = 5;
  private static final int WHEEL_TICK_PIXELS = 60;

  public ProductDetailPageSteps() {
    this.page = new ProductDetailPage();
    this.verification = new ProductDetailPageVerification(this, page);
  }

  @Step("Open the product page")
  public ProductDetailPageSteps openProductPage(ProductListingPojo productListing) {
    page.open(productListing.productId());
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

  @Step("Analyze the product with the primary action of the Hermes card")
  public ProductDetailPageSteps analyzeFromTheCard() {
    page.hermesPrimaryAction().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Open the Hermes drawer from the {row} row of the card")
  public ProductDetailPageSteps openHermesRow(String row) {
    page.hermesRow(row).shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Open the Hermes drawer from the Log and history link")
  public ProductDetailPageSteps openLogAndHistory() {
    page.hermesHistoryLink().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Press Escape and wait until the Hermes drawer is gone")
  public ProductDetailPageSteps closeHermesDrawerWithEscape() {
    Selenide.actions().sendKeys(Keys.ESCAPE).perform();
    page.hermesDrawer().should(Condition.disappear);
    return this;
  }

  @Step("Add the price {price} to Your prices")
  public ProductDetailPageSteps addMyPrice(String price) {
    page.myPriceInput().shouldBe(Condition.visible).setValue(price);
    page.addMyPriceButton().shouldBe(Condition.enabled).click();
    return this;
  }

  @Step("Press Search again and wait until the search is running")
  public ProductDetailPageSteps searchPricesAgain() {
    page.pricesSearchAgainButton().shouldBe(Condition.enabled).click();
    page.pricesSearchAgainButton().shouldHave(Condition.text(SEARCHING));
    return this;
  }

  @Step("Set the missing accessories to {accessories} in the edit form and save")
  public ProductDetailPageSteps saveMissingAccessories(String accessories) {
    page.editProductButton().shouldBe(Condition.enabled).click();
    page.missingAccessoriesInput().shouldBe(Condition.visible).setValue(accessories);
    page.saveChangesButton().shouldBe(Condition.enabled).click();
    page.missingAccessoriesInput().should(Condition.disappear);
    return this;
  }

  @Step("Open the edit form")
  public ProductDetailPageSteps openEditForm() {
    page.editProductButton().shouldBe(Condition.enabled).click();
    page.sellingPriceInput().shouldBe(Condition.visible);
    return this;
  }

  @Step("Type the selling price {price} and scroll the mouse wheel over the focused field")
  public ProductDetailPageSteps typeSellingPriceAndScrollOverIt(String price) {
    // A controlled React number input ignores the WebDriver clear, so the old value is selected and typed over.
    Selenide.executeJavaScript("arguments[0].focus(); arguments[0].select();",
        page.sellingPriceInput().shouldBe(Condition.visible));
    page.sellingPriceInput().sendKeys(price);
    for (int tick = 0; tick < WHEEL_TICKS; tick++) {
      Selenide.actions()
          .scrollFromOrigin(WheelInput.ScrollOrigin.fromElement(page.sellingPriceInput()), 0, WHEEL_TICK_PIXELS)
          .perform();
    }
    return this;
  }

  @Step("Save the product changes")
  public ProductDetailPageSteps saveChanges() {
    page.saveChangesButton().shouldBe(Condition.enabled).click();
    page.sellingPriceInput().should(Condition.disappear);
    return this;
  }

  @Step("Reload the product page")
  public ProductDetailPageSteps reloadPage() {
    Selenide.refresh();
    return this;
  }
}
