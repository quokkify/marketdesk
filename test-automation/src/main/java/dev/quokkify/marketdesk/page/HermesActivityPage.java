package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/hermes")
public class HermesActivityPage implements Page {

  private static final String LIMITS_CARD = "[data-testid=\"hermes-limits-card\"]";
  private static final String LIMIT_ROW = "[data-testid=\"limit-row\"]";
  private static final String USAGE_CARD = "[data-testid=\"ai-usage-card\"]";
  private static final String USAGE_ANALYSES_TODAY = "[data-testid=\"ai-usage-analyses-today\"]";

  public void open() {
    Selenide.open(getUrl());
  }

  public SelenideElement limitsCard() {
    return Selenide.$(LIMITS_CARD);
  }

  public SelenideElement limitRow(String label) {
    return limitsCard().$$(LIMIT_ROW).findBy(Condition.text(label));
  }

  public SelenideElement usageCard() {
    return Selenide.$(USAGE_CARD);
  }

  public SelenideElement analysesToday() {
    return Selenide.$(USAGE_ANALYSES_TODAY);
  }
}
