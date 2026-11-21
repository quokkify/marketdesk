package dev.quokkify.marketdesk.model;

public record ProductRequestPojo(String name, String description, Double costPrice, Double sellingPrice,
    String condition, String category, Double minAcceptablePrice) {

  public static ProductRequestPojo sample() {
    return new ProductRequestPojo("QA reactivation camera", "A camera created by the reactivation API test.", 50.0,
        120.0, "good", "electronics", null);
  }

  public static ProductRequestPojo withPriceFloor(Double sellingPrice, Double minAcceptablePrice) {
    return new ProductRequestPojo("QA price floor camera", "A camera created by the price floor API test.", 50.0,
        sellingPrice, "good", "electronics", minAcceptablePrice);
  }

  public static ProductRequestPojo conversationSample() {
    return new ProductRequestPojo("QA conversation camera", "A camera created by the conversation sync API test.",
        50.0, 100.0, "good", "electronics", null);
  }
}
