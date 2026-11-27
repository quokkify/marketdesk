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

  // A product the listing response tests search for. The name is lowercase letters, digits and spaces, so it is
  // also the buyer query the Hermes mock proposes: the title then holds every query word, and the token keeps the
  // canned answers and search pages of one test apart from the others on the shared mock.
  public static ProductRequestPojo responseSample() {
    String token = "qa" + UUID.randomUUID().toString().replace("-", "").substring(0, RESEARCH_TOKEN_LENGTH);
    return new ProductRequestPojo("test item " + token, "An item created by the listing response test.", 50.0,
        120.0, "good", "electronics", List.of(), null, null);
  }

  // Headphones for the advert completeness checks. The stub OLX suggests its headphones category for this title, and
  // "nauszne" is the one value of the stub category's "type" attribute the title holds. The token keeps the canned
  // answers of one test apart from the others on the shared mock.
  public static ProductRequestPojo headphonesSample() {
    return new ProductRequestPojo("Apple AirPods nauszne sandbox " + token(), "Headphones created by the advert test.",
        50.0, 120.0, "good", "electronics", List.of(), null, null);
  }

  // A projector: the stub OLX suggests its projector category for every title with "projektor".
  public static ProductRequestPojo projectorAdvertSample() {
    return new ProductRequestPojo("AOPEN projektor sandbox " + token(), "A projector created by the advert test.",
        150.0, 349.0, "good", "electronics", List.of(), null, null);
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

  private static String token() {
    return "qa" + UUID.randomUUID().toString().replace("-", "").substring(0, RESEARCH_TOKEN_LENGTH);
  }
}
