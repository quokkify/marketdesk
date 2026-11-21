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
  private static final String RELIST_ON_OLX = "Relist on OLX";
  private static final String REVIVE_ON_OLX = "Revive on OLX";

  public void open(String productId) {
    Selenide.open(getUrl() + "/" + productId);
  }

  public SelenideElement suggestImprovementsButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(SUGGEST_IMPROVEMENTS));
  }

  public SelenideElement aiUsageLine() {
    return Selenide.$(AI_USAGE_LINE);
  }

  public SelenideElement relistButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(RELIST_ON_OLX));
  }

  public SelenideElement reviveButton() {
    return Selenide.$$(BUTTON).findBy(Condition.text(REVIVE_ON_OLX));
  }
}
