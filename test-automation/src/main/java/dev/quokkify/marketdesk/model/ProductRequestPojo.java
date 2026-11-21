package dev.quokkify.marketdesk.model;

public record ProductRequestPojo(String name, String description, Double costPrice, Double sellingPrice,
    String condition, String category) {

  public static ProductRequestPojo sample() {
    return new ProductRequestPojo("QA reactivation camera", "A camera created by the reactivation API test.", 50.0,
        120.0, "good", "electronics");
  }

  public ProductRequestPojo withCondition(String newCondition) {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, newCondition, category);
  }

  public ProductRequestPojo withoutCostPrice() {
    return new ProductRequestPojo(name, description, null, sellingPrice, condition, category);
  }
}
