package dev.quokkify.marketdesk.service;

import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.qameta.allure.http.HttpExchange;
import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.builder.ResponseBuilder;
import io.restassured.filter.FilterContext;
import io.restassured.filter.OrderedFilter;
import io.restassured.response.Response;
import io.restassured.specification.FilterableRequestSpecification;
import io.restassured.specification.FilterableResponseSpecification;
import io.restassured.specification.RequestSender;

/**
 * Attaches the HTTP exchange to the Allure report with the access token removed from the response body.
 * The report is published, and Allure redacts only headers, cookies and parameters on its own. The test
 * still receives the original response.
 */
final class TokenRedactingAllureFilter implements OrderedFilter {

  private static final Pattern TOKEN_FIELD = Pattern.compile("(\"token\"\\s*:\\s*\")[^\"]*(\")");
  private static final String REDACTED_FIELD = "$1" + Matcher.quoteReplacement(HttpExchange.REDACTED_VALUE) + "$2";

  private final AllureRestAssured allure = new AllureRestAssured();

  @Override
  public Response filter(FilterableRequestSpecification requestSpec, FilterableResponseSpecification responseSpec,
                         FilterContext context) {
    AtomicReference<Response> received = new AtomicReference<>();
    Response reported = allure.filter(requestSpec, responseSpec, new ReportedContext(context, received));
    Response original = received.get();
    return original == null ? reported : original;
  }

  @Override
  public int getOrder() {
    return allure.getOrder();
  }

  private static Response withoutToken(Response response) {
    String body = response.asString();
    Matcher token = TOKEN_FIELD.matcher(body);
    if (!token.find()) {
      return response;
    }
    return new ResponseBuilder().clone(response).setBody(token.replaceAll(REDACTED_FIELD)).build();
  }

  private record ReportedContext(FilterContext context, AtomicReference<Response> received) implements FilterContext {

    @Override
    public Response next(FilterableRequestSpecification requestSpec, FilterableResponseSpecification responseSpec) {
      Response response = context.next(requestSpec, responseSpec);
      received.set(response);
      return withoutToken(response);
    }

    @Override
    public Response send(RequestSender requestSender) {
      return context.send(requestSender);
    }

    @Override
    public void setValue(String name, Object value) {
      context.setValue(name, value);
    }

    @Override
    public <T> T getValue(String name) {
      return context.getValue(name);
    }

    @Override
    public boolean hasValue(String name) {
      return context.hasValue(name);
    }

    @Override
    public boolean hasValue(String name, Object value) {
      return context.hasValue(name, value);
    }
  }
}
