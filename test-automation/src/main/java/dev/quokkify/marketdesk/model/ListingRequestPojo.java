package dev.quokkify.marketdesk.model;

public record ListingRequestPojo(String marketplaceKey) {

  public static ListingRequestPojo olx() {
    return new ListingRequestPojo("olx");
  }
}
