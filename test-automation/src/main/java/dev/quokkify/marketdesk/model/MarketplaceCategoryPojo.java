package dev.quokkify.marketdesk.model;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import dev.quokkify.util.JsonConverter;

import com.fasterxml.jackson.annotation.JsonProperty;

// The verified OLX category a listing carries in listings.marketplace_category, in the shape the app parses
// (MarketplaceCategoryMetadata). Marked sandbox, as the stub stack's taxonomy marks its own categories. isLeaf is
// named explicitly: a boolean component that starts with "is" must keep that prefix in the JSON.
public record MarketplaceCategoryPojo(String providerCategoryId, String name, List<String> path, String source,
    double confidence, @JsonProperty("isLeaf") boolean isLeaf, String taxonomyVerifiedAt, String taxonomyStaleAt,
    boolean sandbox) {

  private static final String PROVIDER_TAXONOMY = "provider_taxonomy";
  private static final Duration STALE_AFTER = Duration.ofDays(30);

  // The headphones leaf the stub OLX suggests for every title without "projektor".
  public static MarketplaceCategoryPojo sandboxHeadphones() {
    Instant now = Instant.now();
    return new MarketplaceCategoryPojo("5091", "Headphones", List.of("Electronics", "Headphones"), PROVIDER_TAXONOMY,
        1.0, true, now.toString(), now.plus(STALE_AFTER).toString(), true);
  }

  public String toJson() {
    return JsonConverter.toJson(this);
  }
}
