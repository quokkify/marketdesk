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
  private static final String APPLY_REVIVAL = "Apply and bring back on OLX";
  private static final String REVIVAL_DIALOG = "[data-testid=\"revival-dialog\"]";
  private static final String REVIVAL_CONDITION = "[data-testid=\"revival-condition\"] [role=\"combobox\"]";
  private static final String OPTION = "[role=\"option\"]";

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
}
