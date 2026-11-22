package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.CollectionCondition;
import com.codeborne.selenide.Condition;
import com.codeborne.selenide.ElementsCollection;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/products")
public class ProductsPage implements Page {

  private static final String CATALOGUE_TABLE = "table[aria-label=\"Products catalogue\"]";
  private static final String HEADER_CELLS = CATALOGUE_TABLE + " thead th";
  private static final String BODY_ROWS = CATALOGUE_TABLE + " tbody tr";
  private static final String FILTERS_BUTTON = "button[aria-controls=\"products-filters\"]";
  private static final String FILTERS_PANEL = "#products-filters .MuiCard-root";
  private static final String FILTERS_ENTERED = "#products-filters.MuiCollapse-entered";
  private static final String ANALYZE_BUTTON = "button[aria-label=\"Analyze with AI: %s\"]";
  private static final String REVIEW_TOGGLE = "button[aria-controls^=\"product-review-\"]";
  private static final String REVIEW_REGION = "[id^=\"product-review-\"]";
  private static final String VERDICT_SUMMARY = "[data-testid=\"verdict-summary\"]";
  private static final String VERDICT_CHECK = "[data-testid=\"verdict-check-%s\"]";
  private static final String TAB = "button[aria-label=\"%s products\"]";
  private static final String ROW_ACTIONS = "button[aria-label=\"Actions for %s\"]";
  private static final String MENU_ITEM = "[role=\"menuitem\"]";
  private static final String ANALYZE_WITH_AI = "Analyze with AI";
  private static final String BUTTON = "button";
  private static final String APPROVE = "Approve";
  private static final String DISMISS = "Dismiss";
  private static final String GAP_SCRIPT =
      "const panel = document.querySelector(arguments[0]);"
          + "const table = document.querySelector(arguments[1]).closest('.MuiCard-root');"
          + "return Math.round(table.getBoundingClientRect().top - panel.getBoundingClientRect().bottom);";

  public void open() {
    Selenide.open(getUrl());
  }

  public ElementsCollection headerCells() {
    return Selenide.$$(HEADER_CELLS);
  }

  public SelenideElement filtersButton() {
    return Selenide.$(FILTERS_BUTTON);
  }

  public SelenideElement filtersFullyOpen() {
    return Selenide.$(FILTERS_ENTERED);
  }

  public SelenideElement filtersPanel() {
    return Selenide.$(FILTERS_PANEL);
  }

  public long filtersPanelGap() {
    Number gap = Selenide.executeJavaScript(GAP_SCRIPT, FILTERS_PANEL, CATALOGUE_TABLE);
    return gap == null ? Long.MIN_VALUE : gap.longValue();
  }

  public SelenideElement row(String productName) {
    return Selenide.$$(BODY_ROWS).shouldHave(CollectionCondition.sizeGreaterThan(0))
        .findBy(Condition.text(productName));
  }

  public SelenideElement analyzeButton(String productName) {
    return Selenide.$(String.format(ANALYZE_BUTTON, productName));
  }

  public SelenideElement reviewToggle(String productName) {
    return row(productName).$(REVIEW_TOGGLE);
  }

  public SelenideElement reviewRegion() {
    return Selenide.$(REVIEW_REGION);
  }

  public SelenideElement approveButton() {
    return reviewRegion().$$(BUTTON).findBy(Condition.text(APPROVE));
  }

  public SelenideElement dismissButton() {
    return reviewRegion().$$(BUTTON).findBy(Condition.text(DISMISS));
  }

  public SelenideElement rowActionsButton(String productName) {
    return Selenide.$(String.format(ROW_ACTIONS, productName));
  }

  public SelenideElement analyzeMenuItem() {
    return Selenide.$$(MENU_ITEM).findBy(Condition.text(ANALYZE_WITH_AI));
  }

  public SelenideElement rowVerdict(String productName) {
    return row(productName).$(VERDICT_SUMMARY);
  }

  public SelenideElement rowVerdictCheck(String productName, String check) {
    return rowVerdict(productName).$(String.format(VERDICT_CHECK, check));
  }

  public SelenideElement tab(String label) {
    return Selenide.$(String.format(TAB, label));
  }
}
