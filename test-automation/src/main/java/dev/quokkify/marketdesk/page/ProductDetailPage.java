package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selectors;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;
import org.openqa.selenium.support.FindBy;

@PageUrl("/products")
public class ProductDetailPage implements Page {

  private static final String BUTTON = "button";
  private static final String AI_USAGE_LINE = "[data-testid=\"ai-usage-line\"]";
  private static final String CONVERSATION_THREAD = "[data-testid=\"conversation-thread\"]";
  private static final String REPLY_TEXT = "textarea[data-testid=\"reply-draft-text\"]";
  private static final String SEND = "Send";
  private static final String REPLACE_VALUE_SCRIPT =
      "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(arguments[0], arguments[1]);"
          + "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));";
  private static final String REVIVAL_DIALOG = "[data-testid=\"revival-dialog\"]";
  private static final String REVIVAL_CONDITION = "[data-testid=\"revival-condition\"] [role=\"combobox\"]";
  private static final String OPTION = "[role=\"option\"]";
  private static final String RETAIL_PRICE = "[data-testid=\"price-research-retail-price\"] input";
  private static final String RETAIL_CURRENCY = "[data-testid=\"price-research-currency\"] input";
  private static final String RETAIL_SOURCE = "[data-testid=\"price-research-source\"] input";
  private static final String PRICE_RESEARCH_SAVED = "[data-testid=\"price-research-saved\"]";
  private static final String DISCOUNT_LINE = "[data-testid=\"product-price-discount\"]";
  private static final String ANCHOR_TIER = "[data-testid=\"anchor-tier-%s\"]";
  private static final String ANCHOR_CLASS_LINE = "[data-testid=\"anchor-class-line\"]";
  private static final String MISSING_ACCESSORIES = "//label[text()='Missing accessories']/following::input[1]";
  private static final String ALERT = "[role=\"alert\"]";
  private static final String COMPARABLE_OLX_LINK = "[data-testid=\"comparable-olx-link\"]";
  private static final String PRODUCT_TITLE = "#product-detail-title";
  private static final String SUGGESTED_IMPROVEMENTS = "Suggested improvements";
  private static final String SUGGESTED_PRICE = "Suggested price:";
  private static final String REVIEW_ONLY = "Suggestions are for review only.";
  private static final String DIALOG = "[role=\"dialog\"]";
  private static final String PUBLICATION_QUEUED = "Publication was accepted and queued.";

  @FindBy(xpath = "//button[contains(normalize-space(.), 'Suggest improvements')]")
  private SelenideElement suggestImprovementsButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Publication readiness check')]")
  private SelenideElement publicationReadinessButton;
  @FindBy(xpath = "//button[@aria-label='Publish']")
  private SelenideElement publishButton;
  @FindBy(xpath = "//*[@role='dialog']//button[contains(normalize-space(.), 'Confirm category and queue publish')]")
  private SelenideElement confirmPublicationButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Relist on OLX')]")
  private SelenideElement relistButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Revive on OLX')]")
  private SelenideElement reviveButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Apply and bring back on OLX')]")
  private SelenideElement applyRevivalButton;
  @FindBy(css = "[data-testid=\"price-research-save\"]")
  private SelenideElement savePriceResearchButton;
  @FindBy(css = "[data-testid=\"find-prices-button\"]")
  private SelenideElement findPricesButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Edit product')]")
  private SelenideElement editProductButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Save changes')]")
  private SelenideElement saveChangesButton;

  public void open(String productId) {
    Selenide.open(getUrl() + "/" + productId);
  }

  public SelenideElement suggestImprovementsButton() {
    return suggestImprovementsButton;
  }

  public SelenideElement publicationReadinessButton() {
    return publicationReadinessButton;
  }

  public SelenideElement publishButton() {
    return publishButton;
  }

  public SelenideElement productTitle() {
    return Selenide.$(PRODUCT_TITLE);
  }

  public SelenideElement suggestedImprovementsHeading() {
    return Selenide.$(Selectors.byText(SUGGESTED_IMPROVEMENTS));
  }

  public SelenideElement suggestedPriceHeading() {
    return Selenide.$(Selectors.withText(SUGGESTED_PRICE));
  }

  public SelenideElement reviewOnlyNote() {
    return Selenide.$(Selectors.withText(REVIEW_ONLY));
  }

  // On phones the sidebar is a kept-mounted MUI Drawer, which also carries role="dialog".
  public SelenideElement publicationDialog() {
    return Selenide.$$(DIALOG).findBy(Condition.visible);
  }

  public SelenideElement publicationQueuedNotice() {
    return Selenide.$(Selectors.withText(PUBLICATION_QUEUED));
  }

  public SelenideElement confirmPublicationButton() {
    return confirmPublicationButton;
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
    return relistButton;
  }

  public SelenideElement reviveButton() {
    return reviveButton;
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
    return applyRevivalButton;
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
    return savePriceResearchButton;
  }

  public SelenideElement discountLine() {
    return Selenide.$(DISCOUNT_LINE);
  }

  public SelenideElement priceResearchSavedNote() {
    return Selenide.$(PRICE_RESEARCH_SAVED);
  }

  public SelenideElement findPricesButton() {
    return findPricesButton;
  }

  public SelenideElement anchorTier(String tier) {
    return Selenide.$(String.format(ANCHOR_TIER, tier));
  }

  public SelenideElement anchorClassLine() {
    return Selenide.$(ANCHOR_CLASS_LINE);
  }

  public SelenideElement editProductButton() {
    return editProductButton;
  }

  public SelenideElement missingAccessoriesInput() {
    return Selenide.$x(MISSING_ACCESSORIES);
  }

  public SelenideElement saveChangesButton() {
    return saveChangesButton;
  }

  public SelenideElement alertWithText(String text) {
    return Selenide.$$(ALERT).findBy(Condition.text(text));
  }

  public SelenideElement comparableOlxLink() {
    return Selenide.$(COMPARABLE_OLX_LINK);
  }
}
