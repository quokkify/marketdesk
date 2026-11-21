package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.step.ProductDetailPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductDetailPageVerification
    extends Verification<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  private static final String OFFLINE_USAGE_LINE = "Offline heuristics · no AI usage";

  public ProductDetailPageVerification(ProductDetailPageSteps steps, ProductDetailPage page) {
    super(steps, page);
  }

  @Step("The suggestions say they used offline heuristics and no AI usage")
  public ProductDetailPageVerification showsOfflineUsageLine() {
    page.aiUsageLine().shouldHave(Condition.exactText(OFFLINE_USAGE_LINE), getTimeout());
    return this;
  }

  @Step("The page offers to revive the expired advert, with relist as the second action on the sandbox stack")
  public ProductDetailPageVerification offersReviveAndRelist() {
    page.reviveButton().shouldBe(Condition.visible, getTimeout());
    page.relistButton().shouldBe(Condition.exist, getTimeout());
    return this;
  }

  @Step("The revival dialog asks for the condition and the apply button is disabled")
  public ProductDetailPageVerification revivalNeedsACondition() {
    page.revivalDialog().shouldBe(Condition.visible, getTimeout());
    page.revivalConditionSelect().shouldBe(Condition.visible, getTimeout());
    page.applyRevivalButton().shouldBe(Condition.disabled, getTimeout());
    return this;
  }

  @Step("The apply button is enabled")
  public ProductDetailPageVerification revivalCanBeApplied() {
    page.applyRevivalButton().shouldBe(Condition.enabled, getTimeout());
    return this;
  }

  @Step("The saved retail anchor {price} {currency} from {source} is shown")
  public ProductDetailPageVerification showsRetailAnchor(String price, String currency, String source) {
    page.retailPriceInput().shouldHave(Condition.value(price), getTimeout());
    page.retailCurrencyInput().shouldHave(Condition.value(currency), getTimeout());
    page.retailSourceInput().shouldHave(Condition.value(source), getTimeout());
    return this;
  }

  @Step("The discount against new {retailPrice} from {source} is shown under the product price")
  public ProductDetailPageVerification showsDiscountAgainstNew(String retailPrice, String source) {
    page.discountLine().shouldHave(Condition.text("% vs new · " + retailPrice), getTimeout());
    page.discountLine().shouldHave(Condition.text("(" + source), getTimeout());
    return this;
  }
}
