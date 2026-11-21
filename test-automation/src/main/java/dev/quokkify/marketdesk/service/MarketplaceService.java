package dev.quokkify.marketdesk.service;

import dev.quokkify.marketdesk.model.MarketplaceImportRequestPojo;
import dev.quokkify.util.JsonConverter;

import io.restassured.response.ValidatableResponse;

public class MarketplaceService extends MarketDeskApiService {

  private static final String MARKETPLACES = "/api/marketplaces";
  private static final String IMPORT_PREVIEW = MARKETPLACES + "/%s/import-preview";
  private static final String IMPORT = MARKETPLACES + "/%s/import";

  public ValidatableResponse getMarketplaces(String token) {
    return get(authorized(token), MARKETPLACES);
  }

  public ValidatableResponse previewImport(String token, String marketplaceId, MarketplaceImportRequestPojo body) {
    return post(authorized(token), IMPORT_PREVIEW.formatted(marketplaceId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse previewImport(String marketplaceId, MarketplaceImportRequestPojo body) {
    return post(anonymous(), IMPORT_PREVIEW.formatted(marketplaceId), JsonConverter.toJsonIgnoreNulls(body));
  }

  public ValidatableResponse importAdverts(String token, String marketplaceId, MarketplaceImportRequestPojo body) {
    return post(authorized(token), IMPORT.formatted(marketplaceId), JsonConverter.toJsonIgnoreNulls(body));
  }
}
