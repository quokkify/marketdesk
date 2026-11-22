package dev.quokkify.marketdesk.verification;

import java.util.List;
import java.util.regex.Pattern;

import dev.quokkify.marketdesk.page.ProductsPage;
import dev.quokkify.marketdesk.step.ProductsPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.WebDriverRunner;
import io.qameta.allure.Step;

import static org.assertj.core.api.Assertions.assertThat;

public class ProductsPageVerification
    extends Verification<ProductsPageSteps, ProductsPageVerification, ProductsPage> {

  private static final String PRODUCTS_PATH = "/products";
  private static final String EXPANDED = "aria-expanded";
  private static final String SELECTED = "aria-pressed";
  private static final Pattern ANALYSIS_RESULT = Pattern.compile("\\d+ to review|No new suggestions");
  private static final String ALL_REVIEWED = "All reviewed";
  private static final String NEW_PRODUCT = "New product";
  private static final String NEW_PRODUCT_SUBTITLE = "Add photos, then review and publish.";

  public ProductsPageVerification(ProductsPageSteps steps, ProductsPage page) {
    super(steps, page);
  }

  @Step("The New product dialog is open")
  public ProductsPageVerification newProductDialogIsShown() {
    page.newProductDialog()
        .shouldBe(Condition.visible, getTimeout())
        .shouldHave(Condition.text(NEW_PRODUCT), getTimeout())
        .shouldHave(Condition.text(NEW_PRODUCT_SUBTITLE), getTimeout());
    return this;
  }

  @Step("The New product dialog shows the review step")
  public ProductsPageVerification reviewStepIsShown() {
    page.reviewHeading().shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("Publish to OLX is enabled")
  public ProductsPageVerification publishToOlxIsEnabled() {
    page.publishToOlxButton().shouldBe(Condition.enabled, getTimeout());
    return this;
  }

  // The window size includes browser chrome, so the page may get less height than asked, never more width.
  @Step("The page is laid out {width}px wide and at most {height}px high")
  public ProductsPageVerification viewportIs(int width, int height) {
    assertThat(page.viewportWidth()).isEqualTo(width);
    assertThat(page.viewportHeight()).isPositive().isLessThanOrEqualTo(height);
    return this;
  }

  @Step("Publish to OLX is fully inside the viewport without scrolling")
  public ProductsPageVerification publishToOlxIsFullyInViewport() {
    page.publishToOlxButton().shouldHave(
        Condition.match("fully inside the viewport", page::isFullyInViewport), getTimeout());
    return this;
  }

  @Step("The New product dialog is closed")
  public ProductsPageVerification newProductDialogIsClosed() {
    page.newProductDialog().shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The catalogue shows the columns {columns}")
  public ProductsPageVerification hasColumns(List<String> columns) {
    page.catalogue().shouldSatisfy(snapshot -> assertThat(snapshot.headers()).containsAll(columns), getTimeout());
    return this;
  }

  @Step("The catalogue does not show the columns {columns}")
  public ProductsPageVerification lacksColumns(List<String> columns) {
    page.catalogue().shouldSatisfy(snapshot -> assertThat(snapshot.headers()).doesNotContainAnyElementsOf(columns),
        getTimeout());
    return this;
  }

  @Step("The catalogue lists {productName} exactly once")
  public ProductsPageVerification listsProductOnce(String productName) {
    page.catalogue().shouldSatisfy(page.productLink(), snapshot -> assertThat(
        snapshot.columnItems(page.productColumn()).stream().flatMap(List::stream).filter(productName::equals))
        .hasSize(1), getTimeout());
    return this;
  }

  @Step("The filters panel stays at least {px}px above the table")
  public ProductsPageVerification filtersPanelGapAtLeast(int px) {
    assertThat(page.filtersPanelGap()).isGreaterThanOrEqualTo(px);
    return this;
  }

  @Step("The row of {productName} shows the analysis result")
  public ProductsPageVerification rowShowsAnalysisResult(String productName) {
    page.aiCell(productName).shouldHave(Condition.match("analysis result", element ->
        ANALYSIS_RESULT.matcher(element.getText()).find()), getTimeout());
    return this;
  }

  @Step("The row of {productName} shows {text}")
  public ProductsPageVerification rowShowsText(String productName, String text) {
    page.row(productName).self().shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("The row of {productName} shows the {check} check as {text}")
  public ProductsPageVerification rowShowsVerdictCheck(String productName, String check, String text) {
    page.rowVerdictCheck(productName, check).shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("Suggestions are expanded under {productName}")
  public ProductsPageVerification reviewExpandedUnder(String productName) {
    page.reviewToggle(productName).shouldHave(Condition.attribute(EXPANDED, "true"), getTimeout());
    page.reviewRegion().shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The row of {productName} reads All reviewed and the suggestions are closed")
  public ProductsPageVerification rowShowsAllReviewed(String productName) {
    page.aiCell(productName).shouldHave(Condition.text(ALL_REVIEWED), getTimeout());
    page.reviewRegion().shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The products catalogue is still shown")
  public ProductsPageVerification isOnProductsPage() {
    assertThat(currentPath()).isEqualTo(PRODUCTS_PATH);
    return this;
  }

  @Step("The {label} tab is still selected")
  public ProductsPageVerification tabSelected(String label) {
    page.tab(label).shouldHave(Condition.attribute(SELECTED, "true"));
    return this;
  }

  @Step("The product page of {productId} is shown")
  public ProductsPageVerification isOnProductPage(String productId) {
    assertThat(currentPath()).isEqualTo(PRODUCTS_PATH + "/" + productId);
    return this;
  }

  private static String currentPath() {
    return java.net.URI.create(WebDriverRunner.url()).getPath();
  }
}
