package dev.quokkify.marketdesk.verification;

import java.util.List;
import java.util.regex.Pattern;

import dev.quokkify.marketdesk.page.ProductsPage;
import dev.quokkify.marketdesk.step.ProductsPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.CollectionCondition;
import com.codeborne.selenide.Condition;
import com.codeborne.selenide.WebDriverRunner;
import io.qameta.allure.Step;

import static org.assertj.core.api.Assertions.assertThat;

public class ProductsPageVerification
    extends Verification<ProductsPageSteps, ProductsPageVerification, ProductsPage> {

  private static final String PRODUCTS_PATH = "/products";
  private static final String EXPANDED = "aria-expanded";
  private static final String SELECTED = "aria-pressed";
  private static final String ACTIVE_TAB = "Active";
  private static final Pattern ANALYSIS_RESULT = Pattern.compile("\\d+ to review|No new suggestions");
  private static final String ALL_REVIEWED = "All reviewed";

  public ProductsPageVerification(ProductsPageSteps steps, ProductsPage page) {
    super(steps, page);
  }

  @Step("The catalogue shows the columns {columns}")
  public ProductsPageVerification hasColumns(List<String> columns) {
    page.headerCells().shouldHave(CollectionCondition.sizeGreaterThan(0), getTimeout());
    for (String column : columns) {
      page.headerCells().findBy(Condition.exactText(column)).shouldBe(Condition.visible);
    }
    return this;
  }

  @Step("The catalogue does not show the columns {columns}")
  public ProductsPageVerification lacksColumns(List<String> columns) {
    for (String column : columns) {
      page.headerCells().findBy(Condition.exactText(column)).shouldNot(Condition.exist);
    }
    return this;
  }

  @Step("The filters panel stays at least {px}px above the table")
  public ProductsPageVerification filtersPanelGapAtLeast(int px) {
    assertThat(page.filtersPanelGap()).isGreaterThanOrEqualTo(px);
    return this;
  }

  @Step("The row of {productName} shows the analysis result")
  public ProductsPageVerification rowShowsAnalysisResult(String productName) {
    page.row(productName).shouldHave(Condition.match("analysis result", element ->
        ANALYSIS_RESULT.matcher(element.getText()).find()), getTimeout());
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
    page.row(productName).shouldHave(Condition.text(ALL_REVIEWED), getTimeout());
    page.reviewRegion().shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The products catalogue is still shown")
  public ProductsPageVerification isOnProductsPage() {
    assertThat(currentPath()).isEqualTo(PRODUCTS_PATH);
    return this;
  }

  @Step("The Active tab is still selected")
  public ProductsPageVerification activeTabSelected() {
    page.tab(ACTIVE_TAB).shouldHave(Condition.attribute(SELECTED, "true"));
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
