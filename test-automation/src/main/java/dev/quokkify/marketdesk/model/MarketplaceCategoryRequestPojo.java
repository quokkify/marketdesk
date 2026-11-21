package dev.quokkify.marketdesk.model;

public record MarketplaceCategoryRequestPojo(String providerCategoryId) {

  // A leaf of the fixed sandbox taxonomy the stub OLX adapter accepts.
  public static MarketplaceCategoryRequestPojo sandboxCameras() {
    return new MarketplaceCategoryRequestPojo("1001");
  }
}
