package dev.quokkify.marketdesk.model;

import java.util.List;
import java.util.stream.IntStream;

// Body of PUT /api/products/{id}/price-research; nulls are sent, because null clears the retail anchor.
public record PriceResearchPojo(Double retailPrice, String retailCurrency, String retailSource,
    String retailCheckedAt, List<Comparable> comparables) {

  public record Comparable(Double price, String note) {
  }

  private static final int COMPARABLES_LIMIT = 10;

  public static PriceResearchPojo sample() {
    return new PriceResearchPojo(469.99, "PLN", "MediaMarkt", "2026-11-21",
        List.of(new Comparable(250.0, "Szczecin, used half a year")));
  }

  public PriceResearchPojo withoutRetailAnchor() {
    return new PriceResearchPojo(null, null, null, null, comparables);
  }

  public PriceResearchPojo withRetailPrice(Double newRetailPrice) {
    return new PriceResearchPojo(newRetailPrice, retailCurrency, retailSource, retailCheckedAt, comparables);
  }

  public PriceResearchPojo withTooManyComparables() {
    List<Comparable> many = IntStream.rangeClosed(1, COMPARABLES_LIMIT + 1)
        .mapToObj(i -> new Comparable(100.0 + i, "Advert " + i)).toList();
    return new PriceResearchPojo(retailPrice, retailCurrency, retailSource, retailCheckedAt, many);
  }
}
