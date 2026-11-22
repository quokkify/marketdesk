package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.elements.table.Table;
import dev.quokkify.elements.table.TableLayout;
import dev.quokkify.elements.table.TableRow;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selectors;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;
import com.codeborne.selenide.TextMatchOptions;
import com.codeborne.selenide.WebDriverRunner;
import org.openqa.selenium.By;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.WebElement;

@PageUrl("/products")
public class ProductsPage implements Page {

  private static final String CATALOGUE_TABLE = "table[aria-label=\"Products catalogue\"]";
  private static final String PRODUCT_COLUMN = "Product";
  private static final String UPDATED_COLUMN = "Updated";
  private static final String AI_COLUMN = "AI";
  private static final By PRODUCT_LINK = By.tagName("a");
  private static final String FILTERS_BUTTON = "button[aria-controls=\"products-filters\"]";
  private static final String FILTERS_PANEL = "#products-filters .MuiCard-root";
  private static final String FILTERS_ENTERED = "#products-filters.MuiCollapse-entered";
  private static final String ANALYZE_BUTTON = "button[aria-label=\"Analyze with AI: %s\"]";
  private static final String REVIEW_TOGGLE = "button[aria-controls^=\"product-review-\"]";
  private static final String REVIEW_REGION = "[id^=\"product-review-\"]";
  private static final String TAB = "button[aria-label=\"%s products\"]";
  private static final String ROW_ACTIONS = "button[aria-label=\"Actions for %s\"]";
  private static final String MENU_ITEM = "[role=\"menuitem\"]";
  private static final String ANALYZE_WITH_AI = "Analyze with AI";
  private static final String BUTTON = "button";
  private static final String APPROVE = "Approve";
  private static final String DISMISS = "Dismiss";
  private static final String NEW_PRODUCT = "New product";
  private static final String DIALOG = "[role=\"dialog\"]";
  private static final String CLOSE = "Close";
  private static final String ARIA_LABEL = "aria-label";
  private static final String CLICK_TWICE_SCRIPT = "arguments[0].click(); arguments[0].click();";
  private static final String FULLY_IN_VIEWPORT_SCRIPT =
      "const r = arguments[0].getBoundingClientRect();"
          + "return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;";
  private static final String PHOTO_INPUT = "input[type=\"file\"]";
  private static final String CONTINUE = "Continue";
  private static final String REVIEW_AND_PUBLISH = "Review and publish";
  private static final String NAME = "Name";
  private static final String DESCRIPTION = "Description";
  private static final String SELLING_PRICE = "Selling price";
  private static final String OLX_CATEGORY = "OLX category";
  private static final String PUBLISH_TO_OLX = "Publish to OLX";
  private static final String GAP_SCRIPT =
      "const panel = document.querySelector(arguments[0]);"
          + "const table = document.querySelector(arguments[1]).closest('.MuiCard-root');"
          + "return Math.round(table.getBoundingClientRect().top - panel.getBoundingClientRect().bottom);";

  public void open() {
    Selenide.open(getUrl());
  }

  public Table catalogue() {
    return Table.of(Selenide.$(CATALOGUE_TABLE), TableLayout.html());
  }

  // The Product cell also shows the SKU, so the row is found by the name inside that column, not by exact text.
  public TableRow row(String productName) {
    Table catalogue = catalogue();
    return catalogue.row(catalogue.column(PRODUCT_COLUMN).findBy(Condition.text(productName)).closest("tr"));
  }

  public SelenideElement updatedCell(String productName) {
    return row(productName).cell(UPDATED_COLUMN);
  }

  public SelenideElement aiCell(String productName) {
    return row(productName).cell(AI_COLUMN);
  }

  public By productLink() {
    return PRODUCT_LINK;
  }

  public String productColumn() {
    return PRODUCT_COLUMN;
  }

  public SelenideElement filtersButton() {
    return Selenide.$(FILTERS_BUTTON);
  }

  // Wide screens show a text button, phones an icon button with the same accessible name.
  public SelenideElement newProductButton() {
    return Selenide.$$(BUTTON).filterBy(Condition.visible).findBy(Condition.or(NEW_PRODUCT,
        Condition.text(NEW_PRODUCT), Condition.attribute(ARIA_LABEL, NEW_PRODUCT)));
  }

  public SelenideElement newProductDialog() {
    return Selenide.$(DIALOG);
  }

  public SelenideElement closeDialogButton() {
    return newProductDialog().$$(BUTTON).findBy(Condition.attribute(ARIA_LABEL, CLOSE));
  }

  public SelenideElement photoInput() {
    return newProductDialog().$(PHOTO_INPUT);
  }

  public SelenideElement continueButton() {
    return newProductDialog().$$(BUTTON).findBy(Condition.exactText(CONTINUE));
  }

  public SelenideElement reviewHeading() {
    return newProductDialog().$(Selectors.byText(REVIEW_AND_PUBLISH));
  }

  // Required MUI fields append " *" to the label, so labels match as partial text.
  public SelenideElement nameField() {
    return newProductDialog().$(Selectors.byLabel(NAME, TextMatchOptions.partialText()));
  }

  public SelenideElement descriptionField() {
    return newProductDialog().$(Selectors.byLabel(DESCRIPTION, TextMatchOptions.partialText()));
  }

  public SelenideElement sellingPriceField() {
    return newProductDialog().$(Selectors.byLabel(SELLING_PRICE, TextMatchOptions.partialText()));
  }

  public SelenideElement olxCategoryField() {
    return newProductDialog().$(Selectors.byLabel(OLX_CATEGORY, TextMatchOptions.partialText()));
  }

  public SelenideElement olxCategoryResult(String path) {
    return newProductDialog().$(Selectors.byText(path));
  }

  public SelenideElement publishToOlxButton() {
    return newProductDialog().$$(BUTTON).findBy(Condition.exactText(PUBLISH_TO_OLX));
  }

  // Both clicks run in one script, so React cannot re-render the button as disabled between them.
  public void clickTwiceAtOnce(SelenideElement element) {
    Selenide.executeJavaScript(CLICK_TWICE_SCRIPT, element);
  }

  public boolean isFullyInViewport(WebElement element) {
    return Boolean.TRUE.equals(Selenide.executeJavaScript(FULLY_IN_VIEWPORT_SCRIPT, element));
  }

  public void resizeWindow(int width, int height) {
    WebDriverRunner.getWebDriver().manage().window().setSize(new Dimension(width, height));
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

  public SelenideElement analyzeButton(String productName) {
    return Selenide.$(String.format(ANALYZE_BUTTON, productName));
  }

  public SelenideElement reviewToggle(String productName) {
    return row(productName).self().$(REVIEW_TOGGLE);
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

  public SelenideElement tab(String label) {
    return Selenide.$(String.format(TAB, label));
  }
}
