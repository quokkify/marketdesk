package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.ProductDetailPage;
import dev.quokkify.marketdesk.step.ProductDetailPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.CollectionCondition;
import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class ProductDetailPageVerification
    extends Verification<ProductDetailPageSteps, ProductDetailPageVerification, ProductDetailPage> {

  private static final String SENT = "Sent";
  private static final String OFFLINE_USAGE_LINE = "Offline heuristics · no AI usage";
  private static final String CONDITION_PLACEHOLDER = "Choose condition";
  private static final String UNKNOWN_CONDITION_LABEL = "Requires confirmation";
  private static final String ARIA_SELECTED = "aria-selected";
  private static final String SEARCH_AGAIN = "Search again";
  private static final String YOURS = "yours";
  private static final String RELOAD = "Reload";
  private static final String CONFIRM_PUBLICATION = "Confirm publication request";
  private static final String OLX_FEE = "Confirm possible OLX fee";

  public ProductDetailPageVerification(ProductDetailPageSteps steps, ProductDetailPage page) {
    super(steps, page);
  }

  @Step("The revival proposal says it used offline heuristics and no AI usage")
  public ProductDetailPageVerification showsOfflineUsageLine() {
    page.aiUsageLine().shouldHave(Condition.exactText(OFFLINE_USAGE_LINE), getTimeout());
    return this;
  }

  @Step("The product page shows the publication readiness check")
  public ProductDetailPageVerification showsPublicationReadinessCheck() {
    page.publicationReadinessButton().shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The product page says the publication was queued and shows no dialog")
  public ProductDetailPageVerification showsPublicationQueued() {
    page.publicationQueuedNotice().shouldBe(Condition.visible, getTimeout());
    page.publicationDialog().shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The publication review asks to confirm a possible OLX fee")
  public ProductDetailPageVerification showsOlxFeeConfirmation() {
    page.publicationDialog()
        .shouldBe(Condition.visible, getTimeout())
        .shouldHave(Condition.text(OLX_FEE), getTimeout());
    return this;
  }

  @Step("The publication confirmation dialog is shown")
  public ProductDetailPageVerification showsPublicationConfirmation() {
    page.publicationDialog()
        .shouldBe(Condition.visible, getTimeout())
        .shouldHave(Condition.text(CONFIRM_PUBLICATION), getTimeout());
    page.confirmPublicationButton().shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The conversation of {buyerText} shows the sent reply {reply} and offers no draft to send")
  public ProductDetailPageVerification conversationShowsSentReply(String buyerText, String reply) {
    page.conversationThread(buyerText)
        .shouldHave(Condition.text(reply), getTimeout())
        .shouldHave(Condition.text(SENT), getTimeout());
    page.sendButton(buyerText).shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The conversation of {buyerText} warns about {reason} and offers no Send button")
  public ProductDetailPageVerification conversationWarnsWithoutSend(String buyerText, String reason) {
    page.conversationThread(buyerText).shouldHave(Condition.text(reason), getTimeout());
    page.sendButton(buyerText).shouldNot(Condition.exist, getTimeout());
    return this;
  }

  @Step("The page offers to revive the expired advert, with relist as the second action on the sandbox stack")
  public ProductDetailPageVerification offersReviveAndRelist() {
    page.reviveButton().shouldBe(Condition.visible, getTimeout());
    page.relistButton().shouldBe(Condition.exist, getTimeout());
    return this;
  }

  @Step("The revival dialog shows an empty condition with a placeholder and the apply button is disabled")
  public ProductDetailPageVerification revivalNeedsACondition() {
    page.revivalDialog().shouldBe(Condition.visible, getTimeout());
    page.revivalConditionSelect().shouldHave(Condition.exactText(CONDITION_PLACEHOLDER), getTimeout());
    page.applyRevivalButton().shouldBe(Condition.disabled, getTimeout());
    return this;
  }

  @Step("The revival condition list does not offer the unknown condition")
  public ProductDetailPageVerification revivalConditionsOmitUnknown() {
    page.conditionOption("Good").shouldBe(Condition.visible, getTimeout());
    page.conditionOption(UNKNOWN_CONDITION_LABEL).shouldNot(Condition.exist);
    return this;
  }

  @Step("The apply button is enabled")
  public ProductDetailPageVerification revivalCanBeApplied() {
    page.applyRevivalButton().shouldBe(Condition.enabled, getTimeout());
    return this;
  }

  @Step("The discount against new {retailPrice} from {source} is shown under the product price")
  public ProductDetailPageVerification showsDiscountAgainstNew(String retailPrice, String source) {
    page.discountLine().shouldHave(Condition.text("% vs new · " + retailPrice), getTimeout());
    page.discountLine().shouldHave(Condition.text("(" + source), getTimeout());
    return this;
  }

  @Step("The Hermes card shows the chip {chip}")
  public ProductDetailPageVerification showsHermesChip(String chip) {
    page.hermesChip().shouldHave(Condition.exactText(chip), getTimeout());
    return this;
  }

  @Step("The Hermes card says {text}")
  public ProductDetailPageVerification showsHermesLead(String text) {
    page.hermesLead().shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("The response section of the Hermes card says {text}")
  public ProductDetailPageVerification showsHermesResponse(String text) {
    page.hermesResponse().shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("The Hermes card offers {label} as its primary action")
  public ProductDetailPageVerification offersHermesPrimaryAction(String label) {
    page.hermesPrimaryAction().shouldHave(Condition.exactText(label), getTimeout());
    page.hermesPrimaryAction().shouldBe(Condition.enabled, getTimeout());
    return this;
  }

  @Step("The Hermes drawer is open on the tab {tab}")
  public ProductDetailPageVerification hermesDrawerIsOnTab(String tab) {
    page.hermesDrawer().shouldBe(Condition.visible, getTimeout());
    page.hermesTab(tab).shouldHave(Condition.attribute(ARIA_SELECTED, "true"), getTimeout());
    return this;
  }

  @Step("The product page shows neither the removed Review price button nor the products table verdict summary")
  public ProductDetailPageVerification showsNoOldCards() {
    page.hermesCard().shouldBe(Condition.visible, getTimeout());
    page.removedReviewPriceButton().shouldNot(Condition.exist);
    page.tableVerdictSummary().shouldNot(Condition.exist);
    return this;
  }

  @Step("The Hermes drawer reads the {check} check as {text}")
  public ProductDetailPageVerification checksTabReads(String check, String text) {
    page.hermesCheck(check).shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("The prices found for {tier} include {text}")
  public ProductDetailPageVerification foundPricesInclude(String tier, String text) {
    page.foundPriceRows(tier).findBy(Condition.text(text)).shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The found price links to the advert {href} as open")
  public ProductDetailPageVerification foundPriceLinksTo(String href) {
    page.foundPriceLink(href).shouldHave(Condition.exactText("open"), getTimeout());
    return this;
  }

  @Step("The last price search says {text}")
  public ProductDetailPageVerification showsLastPriceSearch(String text) {
    page.pricesLastRunLine().shouldHave(Condition.text(text), getTimeout());
    return this;
  }

  @Step("The price search has finished and Search again is offered")
  public ProductDetailPageVerification priceSearchHasFinished() {
    page.pricesSearchAgainButton().shouldHave(Condition.exactText(SEARCH_AGAIN), getTimeout());
    return this;
  }

  @Step("Your prices lists {price} marked as yours")
  public ProductDetailPageVerification myPricesInclude(String price) {
    page.myPricesList().shouldHave(Condition.text(price), getTimeout());
    page.myPricesList().shouldHave(Condition.text(YOURS), getTimeout());
    return this;
  }

  @Step("Your prices says {message}, offers Reload and keeps the typed price {price}")
  public ProductDetailPageVerification myPriceSaveConflict(String message, String price) {
    page.myPriceError().shouldHave(Condition.text(message), getTimeout());
    page.myPriceReloadButton().shouldHave(Condition.exactText(RELOAD), getTimeout());
    page.myPriceInput().shouldHave(Condition.exactValue(price), getTimeout());
    return this;
  }

  @Step("The history has an entry whose steps include {step}")
  public ProductDetailPageVerification historyHasStep(String step) {
    page.historyEntries().shouldHave(CollectionCondition.sizeGreaterThan(0), getTimeout());
    page.historySteps().findBy(Condition.text(step)).shouldBe(Condition.visible, getTimeout());
    return this;
  }

  @Step("The selling price field holds exactly {price}")
  public ProductDetailPageVerification sellingPriceIs(String price) {
    page.sellingPriceInput().shouldHave(Condition.exactValue(price), getTimeout());
    return this;
  }
}
