package dev.quokkify.marketdesk.model;

import java.util.regex.Pattern;

// Body of PUT /mockserver/expectation: one canned answer of the Hermes research profile. Sent without nulls,
// so an expectation without times answers every matching call.
public record MockServerExpectationPojo(HttpRequest httpRequest, HttpResponse httpResponse, Times times) {

  // Every research call is a POST to this path of the profile; only the prompt in the body tells them apart.
  private static final String RESEARCH_COMPLETIONS = "/p/marketdesk-research/v1/chat/completions";
  private static final String POST = "POST";
  private static final String REGEX = "REGEX";
  private static final String STRING = "STRING";
  private static final String JSON = "application/json";

  public record HttpRequest(String method, String path, RequestBody body) {

    // Each prompt starts with "Node: <node>." and carries the product name, so one body regex selects
    // the calls of one node for one product.
    public static HttpRequest researchCall(String node, String productName) {
      String regex = ".*Node: " + Pattern.quote(node) + "\\..*" + Pattern.quote(productName) + ".*";
      return new HttpRequest(POST, RESEARCH_COMPLETIONS, new RequestBody(REGEX, regex));
    }
  }

  public record RequestBody(String type, String regex) {
  }

  public record HttpResponse(int statusCode, ResponseBody body) {
  }

  public record ResponseBody(String type, String string, String contentType) {
  }

  public record Times(int remainingTimes, boolean unlimited) {
  }

  public static MockServerExpectationPojo researchAnswer(String node, String productName, int statusCode,
      String completion) {
    return new MockServerExpectationPojo(HttpRequest.researchCall(node, productName),
        new HttpResponse(statusCode, new ResponseBody(STRING, completion, JSON)), null);
  }

  public MockServerExpectationPojo once() {
    return new MockServerExpectationPojo(httpRequest, httpResponse, new Times(1, false));
  }
}
