package dev.quokkify.marketdesk.model;

import java.util.List;

public record ProductRequestPojo(String name, String description, Double costPrice, Double sellingPrice,
    String condition, String category, List<String> images) {

  // A placeholder URL: no stub-stack test fetches the photo, the revival only needs the product to have one.
  private static final String SAMPLE_PHOTO = "https://example.com/qa-camera.jpg";

  public static ProductRequestPojo sample() {
    return new ProductRequestPojo("QA reactivation camera", "A camera created by the reactivation API test.", 50.0,
        120.0, "good", "electronics", List.of());
  }

  public ProductRequestPojo withCondition(String newCondition) {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, newCondition, category, images);
  }

  public ProductRequestPojo withoutCostPrice() {
    return new ProductRequestPojo(name, description, null, sellingPrice, condition, category, images);
  }

  public ProductRequestPojo withPhoto() {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, condition, category,
        List.of(SAMPLE_PHOTO));
  }
}
