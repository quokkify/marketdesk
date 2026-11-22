package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;
import org.openqa.selenium.support.FindBy;

@PageUrl("/marketplaces")
public class MarketplacesPage implements Page {

  @FindBy(xpath = "//button[contains(normalize-space(.), 'Connect sandbox OLX')]")
  private SelenideElement connectSandboxOlxButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Sync now')]")
  private SelenideElement syncNowButton;
  @FindBy(xpath = "//button[contains(normalize-space(.), 'Import from OLX')]")
  private SelenideElement importFromOlxButton;

  public void open() {
    Selenide.open(getUrl());
  }

  public SelenideElement connectSandboxOlxButton() {
    return connectSandboxOlxButton;
  }

  public SelenideElement syncNowButton() {
    return syncNowButton;
  }

  public SelenideElement importFromOlxButton() {
    return importFromOlxButton;
  }
}
