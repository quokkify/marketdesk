package dev.quokkify.marketdesk.model;

// Body of PUT /mockserver/verify: the mock received the matching requests exactly n times.
public record MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest httpRequest, Times times) {

  public record Times(int atLeast, int atMost) {
  }

  public static MockServerVerificationPojo researchCalls(String node, String productName, int count) {
    return new MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest.researchCall(node, productName),
        new Times(count, count));
  }

  public static MockServerVerificationPojo queriesCalls(String productName, int count) {
    return new MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest.queriesCall(productName),
        new Times(count, count));
  }

  // Counts every page of the search, page 1 and the ?page= ones alike.
  public static MockServerVerificationPojo searchRequests(String query, int count) {
    return new MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest.searchPages(query),
        new Times(count, count));
  }
}
