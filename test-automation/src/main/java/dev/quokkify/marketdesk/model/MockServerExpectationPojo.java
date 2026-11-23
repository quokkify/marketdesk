package dev.quokkify.marketdesk.model;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

// Body of PUT /mockserver/expectation: one canned answer of the stand's MockServer, which stands in for the Hermes
// profiles and for the public OLX search pages. Sent without nulls, so an expectation without times answers every
// matching call, and one without query parameters matches a path whatever its query string.
public record MockServerExpectationPojo(HttpRequest httpRequest, HttpResponse httpResponse, Times times,
    Integer priority) {

  // Every research call is a POST to this path of the profile; only the prompt in the body tells them apart.
  private static final String RESEARCH_COMPLETIONS = "/p/marketdesk-research/v1/chat/completions";
  // The main profile the stand's HERMES_API_URL points at; scripts/ci-java-api-tests.sh sets it.
  private static final String MAIN_COMPLETIONS = "/p/marketdesk/v1/chat/completions";
  // OLX_SEARCH_BASE_URL of the stand ends in this prefix; the app adds /oferty/q-<words>/ to it.
  private static final String OLX_SEARCH = "/olx-search/oferty/q-%s/";
  // The fixed wording of the buyer-queries prompt (listingResponsePrompts.ts); no other main-profile prompt has it.
  private static final String QUERIES_PROMPT = "would type into the marketplace search box";
  private static final String POST = "POST";
  private static final String GET = "GET";
  private static final String REGEX = "REGEX";
  private static final String STRING = "STRING";
  private static final String JSON = "application/json";
  private static final String HTML = "text/html; charset=utf-8";
  private static final String PAGE = "page";

  public record HttpRequest(String method, String path, Map<String, List<String>> queryStringParameters,
      RequestBody body) {

    // Each prompt starts with "Node: <node>." and carries the product name, so one body regex selects
    // the calls of one node for one product.
    public static HttpRequest researchCall(String node, String productName) {
      String regex = ".*Node: " + Pattern.quote(node) + "\\..*" + Pattern.quote(productName) + ".*";
      return new HttpRequest(POST, RESEARCH_COMPLETIONS, null, new RequestBody(REGEX, regex));
    }

    // The buyer-queries call of the listing response graph for one product.
    public static HttpRequest queriesCall(String productName) {
      String regex = ".*" + Pattern.quote(QUERIES_PROMPT) + ".*" + Pattern.quote(productName) + ".*";
      return new HttpRequest(POST, MAIN_COMPLETIONS, null, new RequestBody(REGEX, regex));
    }

    // Every page of the OLX search for one query: the app joins the query words with hyphens.
    public static HttpRequest searchPages(String query) {
      return new HttpRequest(GET, OLX_SEARCH.formatted(query.replace(' ', '-')), null, null);
    }

    public static HttpRequest searchPage(String query, int page) {
      return new HttpRequest(GET, OLX_SEARCH.formatted(query.replace(' ', '-')),
          Map.of(PAGE, List.of(String.valueOf(page))), null);
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
        new HttpResponse(statusCode, new ResponseBody(STRING, completion, JSON)), null, null);
  }

  public static MockServerExpectationPojo queriesAnswer(String productName, int statusCode, String completion) {
    return new MockServerExpectationPojo(HttpRequest.queriesCall(productName),
        new HttpResponse(statusCode, new ResponseBody(STRING, completion, JSON)), null, null);
  }

  // Page 1 carries no ?page= parameter, so its expectation matches the path whatever the query string; a later
  // page gets a higher priority and wins for its own ?page=N.
  public static MockServerExpectationPojo searchPageAnswer(String query, int page, int statusCode, String html) {
    HttpRequest request = page == 1 ? HttpRequest.searchPages(query) : HttpRequest.searchPage(query, page);
    return new MockServerExpectationPojo(request, new HttpResponse(statusCode, new ResponseBody(STRING, html, HTML)),
        null, page == 1 ? 0 : page);
  }

  public MockServerExpectationPojo once() {
    return new MockServerExpectationPojo(httpRequest, httpResponse, new Times(1, false), priority);
  }
}
