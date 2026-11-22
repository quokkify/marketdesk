package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/products")
public class ProductDetailPage implements Page {

  private static final String BUTTON = "button";
  private static final String SUGGEST_IMPROVEMENTS = "Suggest improvements";
  private static final String AI_USAGE_LINE = "[data-testid=\"ai-usage-line\"]";
  private static final String CONVERSATION_THREAD = "[data-testid=\"conversation-thread\"]";
  private static final String REPLY_TEXT = "textarea[data-testid=\"reply-draft-text\"]";
  private static final String SEND = "Send";
  private static final String REPLACE_VALUE_SCRIPT =
      "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(arguments[0], arguments[1]);"
          + "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));";
  private static final String RELIST_ON_OLX = "Relist on OLX";
  private static final String REVIVE_ON_OLX = "Revive on OLX";
  private static final String APPLY_REVIVAL = "Apply and bring back on OLX";
  private static final String REVIVAL_DIALOG = "[data-testid=\"revival-dialog\"]";
  private static final String REVIVAL_CONDITION = "[data-testid=\"revival-condition\"] [role=\"combobox\"]";
  private static final String OPTION = "[role=\"option\"]";
  private static final String RETAIL_PRICE = "[data-testid=\"price-research-retail-price\"] input";
  private static final String RETAIL_CURRENCY = "[data-testid=\"price-research-currency\"] input";
  private static final String RETAIL_SOURCE = "[data-testid=\"price-research-source\"] input";
  private static final String SAVE_PRICE_RESEARCH = "[data-testid=\"price-research-save\"]";
  private static final String PRICE_RESEARCH_SAVED = "[data-testid=\"price-research-saved\"]";
  private static final String DISCOUNT_LINE = "[data-testid=\"product-price-discount\"]";
  private static final String FIND_PRICES = "[data-testid=\"find-prices-button\"]";
  private static final String ANCHOR_TIER = "[data-testid=\"anchor-tier-%s\"]";
  private static final String ANCHOR_CLASS_LINE = "[data-testid=\"anchor-class-line\"]";
  private static final String EDIT_PRODUCT = "Edit product";
  private static final String MISSING_ACCESSORIES = "//label[text()='Missing accessories']/following::input[1]";
  private static final String SAVE_CHANGES = "Save changes";
  private static final String ALERT = "[role=\"alert\"]";
  private static final String COMPARABLE_OLX_LINK = "[data-testid=\"comparable-olx-link\"]";

  public void open(String productId) {
    Selenide.open(getUrl() + "/" + productId);
  }

  public SelenideElement suggestImprovementsButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(SUGGEST_IMPROVEMENTS));
  }

  public SelenideElement aiUsageLine() {
    return Selenide.$(AI_USAGE_LINE);
  }

  public SelenideElement conversationThread(String buyerText) {
    return Selenide.$$(CONVERSATION_THREAD).findBy(Condition.text(buyerText));
  }

  public SelenideElement replyText(String buyerText) {
    return conversationThread(buyerText).$(REPLY_TEXT);
  }

  // A controlled React textarea ignores the WebDriver clear, so the value goes through the native setter.
  public void replaceReplyText(String buyerText, String text) {
    Selenide.executeJavaScript(REPLACE_VALUE_SCRIPT, replyText(buyerText).shouldBe(Condition.visible), text);
  }

  public SelenideElement sendButton(String buyerText) {
    return conversationThread(buyerText).$$(BUTTON).findBy(Condition.exactText(SEND));
  }

  public SelenideElement relistButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(RELIST_ON_OLX));
  }

  public SelenideElement reviveButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(REVIVE_ON_OLX));
  }

  public SelenideElement revivalDialog() {
    return Selenide.$(REVIVAL_DIALOG);
  }

  public SelenideElement revivalConditionSelect() {
    return Selenide.$(REVIVAL_CONDITION);
  }

  public SelenideElement conditionOption(String label) {
    return Selenide.$$(OPTION).findBy(Condition.exactText(label));
  }

  public SelenideElement applyRevivalButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(APPLY_REVIVAL));
  }

  public SelenideElement retailPriceInput() {
    return Selenide.$(RETAIL_PRICE);
  }

  public SelenideElement retailCurrencyInput() {
    return Selenide.$(RETAIL_CURRENCY);
  }

  public SelenideElement retailSourceInput() {
    return Selenide.$(RETAIL_SOURCE);
  }

  public SelenideElement savePriceResearchButton() {
    return Selenide.$(SAVE_PRICE_RESEARCH);
  }

  public SelenideElement discountLine() {
    return Selenide.$(DISCOUNT_LINE);
  }

  public SelenideElement priceResearchSavedNote() {
    return Selenide.$(PRICE_RESEARCH_SAVED);
  }

  public SelenideElement findPricesButton() {
    return Selenide.$(FIND_PRICES);
  }

  public SelenideElement anchorTier(String tier) {
    return Selenide.$(String.format(ANCHOR_TIER, tier));
  }

  public SelenideElement anchorClassLine() {
    return Selenide.$(ANCHOR_CLASS_LINE);
  }

  public SelenideElement editProductButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(EDIT_PRODUCT));
  }

  public SelenideElement missingAccessoriesInput() {
    return Selenide.$x(MISSING_ACCESSORIES);
  }

  public SelenideElement saveChangesButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(SAVE_CHANGES));
  }

  public SelenideElement alertWithText(String text) {
    return Selenide.$$(ALERT).findBy(Condition.text(text));
  }

  public SelenideElement comparableOlxLink() {
    return Selenide.$(COMPARABLE_OLX_LINK);
  }
}
