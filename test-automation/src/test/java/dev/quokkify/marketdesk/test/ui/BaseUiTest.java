package dev.quokkify.marketdesk.test.ui;

import dev.quokkify.marketdesk.helper.BrowserSession;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeClass;

public abstract class BaseUiTest extends BaseTest {

  @BeforeClass(alwaysRun = true)
  public void openBrowserSession() {
    BrowserSession.open();
  }

  @AfterMethod(alwaysRun = true)
  public void closeBrowserSession() {
    BrowserSession.close();
  }
}
