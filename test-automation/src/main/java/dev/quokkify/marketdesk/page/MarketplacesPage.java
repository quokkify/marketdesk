package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Condition;
import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/marketplaces")
public class MarketplacesPage implements Page {

  private static final String BUTTON = "button";
  private static final String CONNECT_SANDBOX_OLX = "Connect sandbox OLX";
  private static final String SYNC_NOW = "Sync now";
  private static final String IMPORT_FROM_OLX = "Import from OLX";

  public void open() {
    Selenide.open(getUrl());
  }

  public SelenideElement connectSandboxOlxButton() {
    return button(CONNECT_SANDBOX_OLX);
  }

  public SelenideElement syncNowButton() {
    return button(SYNC_NOW);
  }

  public SelenideElement importFromOlxButton() {
    return button(IMPORT_FROM_OLX);
  }

  private SelenideElement button(String text) {
    return Selenide.$$(BUTTON).findBy(Condition.text(text));
  }
}
