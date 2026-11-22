package dev.quokkify.marketdesk.model;

// Body of PUT /mockserver/verify: the research calls of one node for one product were received exactly n times.
public record MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest httpRequest, Times times) {

  public record Times(int atLeast, int atMost) {
  }

  public static MockServerVerificationPojo researchCalls(String node, String productName, int count) {
    return new MockServerVerificationPojo(MockServerExpectationPojo.HttpRequest.researchCall(node, productName),
        new Times(count, count));
  }
}
