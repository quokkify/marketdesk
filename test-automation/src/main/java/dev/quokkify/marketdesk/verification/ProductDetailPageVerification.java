package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.step.ProductDetailPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductDetailPageVerification
    extends Verification<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  private static final String SENT = "Sent";
  private static final String OFFLINE_USAGE_LINE = "Offline heuristics · no AI usage";
  private static final String CONDITION_PLACEHOLDER = "Choose condition";
  private static final String UNKNOWN_CONDITION_LABEL = "Requires confirmation";

  public ProductDetailPageVerification(ProductDetailPageSteps steps, ProductDetailPage page) {
    super(steps, page);
  }

  @Step("The suggestions say they used offline heuristics and no AI usage")
  public ProductDetailPageVerification showsOfflineUsageLine() {
    page.aiUsageLine().shouldHave(Condition.exactText(OFFLINE_USAGE_LINE), getTimeout());
    return this;
  }

  @Step("The conversation of {buyerText} shows the sent reply {reply} and offers no draft to send")
  public ProductDetailPageVerification conversationShowsSentReply(String buyerText, String reply) {
    page.conversationThread(buyerText)
        .shouldHave(Condition.text(reply), getTimeout())
        .shouldHave(Condition.text(SENT), getTimeout());
    page.sendButton(buyerText).shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The conversation of {buyerText} warns about {reason} and offers no Send button")
  public ProductDetailPageVerification conversationWarnsWithoutSend(String buyerText, String reason) {
    page.conversationThread(buyerText).shouldHave(Condition.text(reason), getTimeout());
    page.sendButton(buyerText).shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The page offers to revive the expired advert, with relist as the second action on the sandbox stack")
  public ProductDetailPageVerification offersReviveAndRelist() {
    page.reviveButton().shouldBe(Condition.visible, getTimeout());
    page.relistButton().shouldBe(Condition.exist, getTimeout());
    return this;
  }

  @Step("The revival dialog shows an empty condition with a placeholder and the apply button is disabled")
  public ProductDetailPageVerification revivalNeedsACondition() {
    page.revivalDialog().shouldBe(Condition.visible, getTimeout());
    page.revivalConditionSelect().shouldHave(Condition.exactText(CONDITION_PLACEHOLDER), getTimeout());
    page.applyRevivalButton().shouldBe(Condition.disabled, getTimeout());
    return this;
  }

  @Step("The revival condition list does not offer the unknown condition")
  public ProductDetailPageVerification revivalConditionsOmitUnknown() {
    page.conditionOption("Good").shouldBe(Condition.visible, getTimeout());
    page.conditionOption(UNKNOWN_CONDITION_LABEL).shouldNot(Condition.exist);
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

  @Step("The page says {message}")
  public ProductDetailPageVerification showsAlert(String message) {
    page.alertWithText(message).shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The saved comparable shows an OLX link to {href}")
  public ProductDetailPageVerification showsOlxLink(String href) {
    page.comparableOlxLink().shouldHave(Condition.text("OLX"), getTimeout());
    page.comparableOlxLink().shouldHave(Condition.attribute("href", href), getTimeout());
    return this;
  }

  @Step("The {label} anchor line says {text}")
  public ProductDetailPageVerification showsAnchorTier(String tier, String label, String text) {
    page.anchorTier(tier).shouldHave(Condition.text(label), getTimeout());
    page.anchorTier(tier).shouldHave(Condition.text(text), getTimeout());
    return this;
  }
}
