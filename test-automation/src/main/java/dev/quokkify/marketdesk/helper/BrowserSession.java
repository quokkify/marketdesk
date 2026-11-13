package dev.quokkify.marketdesk.helper;

import dev.quokkify.config.BrowserConfiguration;
import dev.quokkify.config.ConfigRegistry;
import dev.quokkify.marketdesk.config.MarketDeskUiConfig;
import dev.quokkify.service.Browser;

import com.codeborne.selenide.Configuration;
import com.codeborne.selenide.Selenide;

public final class BrowserSession {

  private static final BrowserConfiguration BROWSER_CONFIG = ConfigRegistry.get(BrowserConfiguration.class);

  private BrowserSession() {
  }

  private static boolean configured;

  public static void open() {
    configureOnce();
  }

  private static synchronized void configureOnce() {
    if (configured) {
      return;
    }
    Browser.setDefaultConfigurations();
    if (BROWSER_CONFIG.remoteUrl() != null) {
      Browser.setRemoteDefaultConfiguration();
    }
    Configuration.headless = true;
    Configuration.baseUrl = MarketDeskUiConfig.BASE_URI;
    configured = true;
  }

  public static void close() {
    Selenide.closeWebDriver();
  }
}
