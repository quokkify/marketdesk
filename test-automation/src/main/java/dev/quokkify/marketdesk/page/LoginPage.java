package dev.quokkify.marketdesk.page;

import dev.quokkify.annotation.PageUrl;
import dev.quokkify.impl.Page;

import com.codeborne.selenide.Selenide;
import com.codeborne.selenide.SelenideElement;

@PageUrl("/login")
public class LoginPage implements Page {

  private static final String EMAIL_INPUT = "input[type=email]";
  private static final String PASSWORD_INPUT = "input[type=password]";
  private static final String SUBMIT_BUTTON = "button[type=submit]";
  private static final String SEARCH_PRODUCTS = "[aria-label=\"Search products\"]";

  public void open() {
    Selenide.open(getUrl());
  }

  public void fillEmail(String email) {
    Selenide.$(EMAIL_INPUT).setValue(email);
  }

  public void fillPassword(String password) {
    Selenide.$(PASSWORD_INPUT).setValue(password);
  }

  public void submit() {
    Selenide.$(SUBMIT_BUTTON).click();
  }

  public SelenideElement searchProductsField() {
    return Selenide.$(SEARCH_PRODUCTS);
  }
}
