package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.step.ProductDetailPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductDetailPageVerification
    extends Verification<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  private static final String OFFLINE_USAGE_LINE = "Offline heuristics · no AI usage";

  public ProductDetailPageVerification(ProductDetailPageSteps steps, ProductDetailPage page) {
    super(steps, page);
  }

  @Step("The suggestions say they used offline heuristics and no AI usage")
  public ProductDetailPageVerification showsOfflineUsageLine() {
    page.aiUsageLine().shouldHave(Condition.exactText(OFFLINE_USAGE_LINE), getTimeout());
    return this;
  }

  @Step("The page offers to relist the expired sandbox advert, not to revive it")
  public ProductDetailPageVerification offersRelistNotRevive() {
    page.relistButton().shouldBe(Condition.visible, getTimeout());
    page.reviveButton().shouldNot(Condition.exist);
    return this;
  }
}
