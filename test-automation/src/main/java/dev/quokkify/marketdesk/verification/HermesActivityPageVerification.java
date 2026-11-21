package dev.quokkify.marketdesk.verification;

import dev.quokkify.marketdesk.page.HermesActivityPage;
import dev.quokkify.marketdesk.step.HermesActivityPageSteps;
import dev.quokkify.model.Verification;

import com.codeborne.selenide.Condition;
import io.qameta.allure.Step;

public class HermesActivityPageVerification
    extends Verification<HermesActivityPageSteps, HermesActivityPageVerification, HermesActivityPage> {

  private static final String PLAN = "Plus";
  private static final String SESSION_ROW = "Session 4%";
  private static final String WEEKLY_ROW = "Weekly 10%";
  private static final String SESSION_WINDOW = "Session";
  private static final String WEEKLY_WINDOW = "Weekly";
  private static final String ACCOUNT_WIDE = "account-wide, shared with all Hermes use";

  public HermesActivityPageVerification(HermesActivityPageSteps steps, HermesActivityPage page) {
    super(steps, page);
  }

  @Step("The limits card shows the plan, the windows and that the limits are account-wide")
  public HermesActivityPageVerification limitsCardShowsPlanAndWindows() {
    page.limitsCard().shouldBe(Condition.visible, getTimeout())
        .shouldHave(Condition.text(PLAN), getTimeout())
        .shouldHave(Condition.text(ACCOUNT_WIDE), getTimeout());
    page.limitRow(SESSION_WINDOW).shouldHave(Condition.exactText(SESSION_ROW), getTimeout());
    page.limitRow(WEEKLY_WINDOW).shouldHave(Condition.exactText(WEEKLY_ROW), getTimeout());
    return this;
  }

  @Step("The usage card counts {analyses} analysis today")
  public HermesActivityPageVerification usageCardCountsAnalysesToday(int analyses) {
    page.usageCard().shouldBe(Condition.visible, getTimeout());
    page.analysesToday().shouldHave(Condition.exactText(String.valueOf(analyses)), getTimeout());
    return this;
  }
}
