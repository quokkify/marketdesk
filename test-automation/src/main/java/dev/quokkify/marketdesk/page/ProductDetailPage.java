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
}
