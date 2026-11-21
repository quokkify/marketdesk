package dev.quokkify.marketdesk.model;

// Fields are Object so tests can send the malformed shapes the endpoint must reject.
public record MarketplaceImportRequestPojo(Object pageSize, Object statuses, Object externalListingIds,
    String workspaceId) {

  public static MarketplaceImportRequestPojo empty() {
    return new MarketplaceImportRequestPojo(null, null, null, null);
  }

  public static MarketplaceImportRequestPojo withPageSize(Object pageSize) {
    return new MarketplaceImportRequestPojo(pageSize, null, null, null);
  }

  public static MarketplaceImportRequestPojo withStatuses(Object statuses) {
    return new MarketplaceImportRequestPojo(null, statuses, null, null);
  }

  public static MarketplaceImportRequestPojo withExternalListingIds(Object externalListingIds) {
    return new MarketplaceImportRequestPojo(null, null, externalListingIds, null);
  }
}
