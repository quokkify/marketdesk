package dev.quokkify.marketdesk.model;

// Body of POST /api/listings/{id}/revive; only the ticked changes are sent, so absent fields stay null and are dropped.
public record RevivalRequestPojo(String condition, Double costPrice, Double price, Boolean allowBelowCost,
    String productUpdatedAt, String listingUpdatedAt) {

  // A timestamp no product or listing of a fresh account carries, so the apply reads as stale.
  private static final String LONG_AGO = "2020-01-01T00:00:00.000Z";

  public static RevivalRequestPojo of(String condition, String productUpdatedAt, String listingUpdatedAt) {
    return new RevivalRequestPojo(condition, null, null, null, productUpdatedAt, listingUpdatedAt);
  }

  public static RevivalRequestPojo longAgo(String condition) {
    return of(condition, LONG_AGO, LONG_AGO);
  }

  public RevivalRequestPojo withProductChangedLongAgo() {
    return new RevivalRequestPojo(condition, costPrice, price, allowBelowCost, LONG_AGO, listingUpdatedAt);
  }

  public RevivalRequestPojo withPrices(Double newCostPrice, Double newPrice) {
    return new RevivalRequestPojo(condition, newCostPrice, newPrice, allowBelowCost, productUpdatedAt,
        listingUpdatedAt);
  }
}
