package dev.quokkify.marketdesk.model;

import java.util.List;
import java.util.UUID;

public record ProductRequestPojo(String name, String description, Double costPrice, Double sellingPrice,
    String condition, String category, List<String> images, Double minAcceptablePrice,
    String missingAccessories) {

  // A placeholder URL: no stub-stack test fetches the photo, the revival only needs the product to have one.
  private static final String SAMPLE_PHOTO = "https://example.com/qa-camera.jpg";
  private static final int RESEARCH_TOKEN_LENGTH = 12;

  public static ProductRequestPojo sample() {
    return new ProductRequestPojo("QA reactivation camera", "A camera created by the reactivation API test.", 50.0,
        120.0, "good", "electronics", List.of(), null, null);
  }

  public static ProductRequestPojo withPriceFloor(Double sellingPrice, Double minAcceptablePrice) {
    return new ProductRequestPojo("QA price floor camera", "A camera created by the price floor API test.", 50.0,
        sellingPrice, "good", "electronics", List.of(), minAcceptablePrice, null);
  }

  public static ProductRequestPojo conversationSample() {
    return new ProductRequestPojo("QA conversation camera", "A camera created by the conversation sync API test.",
        50.0, 100.0, "good", "electronics", List.of(), null, null);
  }

  // The projector of the recorded research answers. The name ends in a token of its own, so the canned answers
  // of one test match only the prompts about this product; letters and digits survive the search name sanitizing.
  public static ProductRequestPojo researchSample() {
    String token = "QA" + UUID.randomUUID().toString().replace("-", "").substring(0, RESEARCH_TOKEN_LENGTH);
    return new ProductRequestPojo("AOPEN QH11 projektor " + token, "A projector created by the price research API test.",
        150.0, 349.0, "good", "projectors", List.of(), null, null);
  }

  public ProductRequestPojo withCondition(String newCondition) {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, newCondition, category, images,
        minAcceptablePrice, missingAccessories);
  }

  public ProductRequestPojo withoutCostPrice() {
    return new ProductRequestPojo(name, description, null, sellingPrice, condition, category, images,
        minAcceptablePrice, missingAccessories);
  }

  public ProductRequestPojo withPhoto() {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, condition, category,
        List.of(SAMPLE_PHOTO), minAcceptablePrice, missingAccessories);
  }

  public ProductRequestPojo withMissingAccessories(String newMissingAccessories) {
    return new ProductRequestPojo(name, description, costPrice, sellingPrice, condition, category, images,
        minAcceptablePrice, newMissingAccessories);
  }
}
