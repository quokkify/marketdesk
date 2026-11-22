package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.ElementsCollection;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/products")
public class ProductDetailPage implements Page {

  private static final String BUTTON = "button";
  private static final String AI_USAGE_LINE = "[data-testid=\"revival-ai-usage\"]";
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
  private static final String DISCOUNT_LINE = "[data-testid=\"product-price-discount\"]";
  private static final String HERMES_CARD = "[data-testid=\"hermes-card\"]";
  private static final String HERMES_CHIP = "[data-testid=\"hermes-chip\"]";
  private static final String HERMES_LEAD = "[data-testid=\"hermes-lead\"]";
  private static final String HERMES_PRIMARY_ACTION = "[data-testid=\"hermes-primary-action\"]";
  private static final String HERMES_ROW = "[data-testid=\"hermes-row-%s\"]";
  private static final String HERMES_HISTORY_LINK = "[data-testid=\"hermes-history-link\"]";
  // The app has a second drawer in the DOM, the phone sidebar; the Hermes one is the dialog inside its own root.
  private static final String HERMES_DRAWER = "[data-testid=\"hermes-drawer\"] [role=\"dialog\"]";
  private static final String HERMES_TAB = "[data-testid=\"hermes-tab-%s\"]";
  private static final String HERMES_CHECK = "[data-testid=\"hermes-check-%s\"]";
  private static final String PRICES_SEARCH_AGAIN = "[data-testid=\"prices-search-again\"]";
  private static final String PRICES_LAST_RUN = "[data-testid=\"prices-last-run\"]";
  private static final String PRICES_FOUND_TIER = "[data-testid=\"found-tier-%s\"]";
  private static final String PRICES_FOUND_LINK = "[data-testid=\"prices-found-list\"] a[href=\"%s\"]";
  private static final String MY_PRICES_LIST = "[data-testid=\"my-prices-list\"]";
  private static final String MY_PRICE_INPUT = "[data-testid=\"my-price-price\"]";
  private static final String MY_PRICE_ADD = "[data-testid=\"my-price-add\"]";
  private static final String HISTORY_ENTRY = "[data-testid=\"history-entry\"]";
  private static final String HISTORY_STEP = "[data-testid=\"history-step\"]";
  private static final String REMOVED_REVIEW_PRICE = "[data-testid=\"review-price-button\"]";
  private static final String TABLE_VERDICT_SUMMARY = "[data-testid=\"verdict-summary\"]";
  private static final String EDIT_PRODUCT = "Edit product";
  private static final String MISSING_ACCESSORIES = "//label[text()='Missing accessories']/following::input[1]";
  private static final String SELLING_PRICE = "//label[text()='Selling price']/following::input[1]";
  private static final String SAVE_CHANGES = "Save changes";

  public void open(String productId) {
    Selenide.open(getUrl() + "/" + productId);
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

  public SelenideElement discountLine() {
    return Selenide.$(DISCOUNT_LINE);
  }

  public SelenideElement hermesCard() {
    return Selenide.$(HERMES_CARD);
  }

  public SelenideElement hermesChip() {
    return Selenide.$(HERMES_CHIP);
  }

  public SelenideElement hermesLead() {
    return Selenide.$(HERMES_LEAD);
  }

  public SelenideElement hermesPrimaryAction() {
    return Selenide.$(HERMES_PRIMARY_ACTION);
  }

  public SelenideElement hermesRow(String key) {
    return Selenide.$(String.format(HERMES_ROW, key));
  }

  public SelenideElement hermesHistoryLink() {
    return Selenide.$(HERMES_HISTORY_LINK);
  }

  public SelenideElement hermesDrawer() {
    return Selenide.$(HERMES_DRAWER);
  }

  public SelenideElement hermesTab(String tab) {
    return hermesDrawer().$(String.format(HERMES_TAB, tab));
  }

  public SelenideElement hermesCheck(String check) {
    return hermesDrawer().$(String.format(HERMES_CHECK, check));
  }

  public SelenideElement pricesSearchAgainButton() {
    return hermesDrawer().$(PRICES_SEARCH_AGAIN);
  }

  public SelenideElement pricesLastRunLine() {
    return hermesDrawer().$(PRICES_LAST_RUN);
  }

  public ElementsCollection foundPriceRows(String tier) {
    return hermesDrawer().$$(String.format(PRICES_FOUND_TIER, tier));
  }

  public SelenideElement foundPriceLink(String href) {
    return hermesDrawer().$(String.format(PRICES_FOUND_LINK, href));
  }

  public SelenideElement myPricesList() {
    return hermesDrawer().$(MY_PRICES_LIST);
  }

  public SelenideElement myPriceInput() {
    return hermesDrawer().$(MY_PRICE_INPUT);
  }

  public SelenideElement addMyPriceButton() {
    return hermesDrawer().$(MY_PRICE_ADD);
  }

  public ElementsCollection historyEntries() {
    return hermesDrawer().$$(HISTORY_ENTRY);
  }

  public ElementsCollection historySteps() {
    return hermesDrawer().$$(HISTORY_STEP);
  }

  public SelenideElement removedReviewPriceButton() {
    return Selenide.$(REMOVED_REVIEW_PRICE);
  }

  public SelenideElement tableVerdictSummary() {
    return Selenide.$(TABLE_VERDICT_SUMMARY);
  }

  public SelenideElement editProductButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(EDIT_PRODUCT));
  }

  public SelenideElement missingAccessoriesInput() {
    return Selenide.$x(MISSING_ACCESSORIES);
  }

  public SelenideElement sellingPriceInput() {
    return Selenide.$x(SELLING_PRICE);
  }

  public SelenideElement saveChangesButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(SAVE_CHANGES));
  }
}
