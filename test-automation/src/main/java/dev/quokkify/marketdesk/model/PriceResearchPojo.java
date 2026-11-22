package dev.quokkify.marketdesk.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

// Body of PUT /api/products/{id}/price-research; nulls are sent, because null clears the retail anchor.
public record PriceResearchPojo(Double retailPrice, String retailCurrency, String retailSource,
    String retailCheckedAt, List<Comparable> comparables) {

  public record Comparable(Double price, String note, String url, String source, String tier, String seenAt) {

    public Comparable(Double price, String note) {
      this(price, note, null, null, null, null);
    }

    public Comparable(Double price, String note, String url, String source) {
      this(price, note, url, source, null, null);
    }
  }

  private static final int COMPARABLES_LIMIT = 30;

  public static PriceResearchPojo sample() {
    return new PriceResearchPojo(469.99, "PLN", "MediaMarkt", "2026-11-21",
        List.of(new Comparable(250.0, "Szczecin, used half a year")));
  }

  public PriceResearchPojo withComparable(Comparable comparable) {
    return new PriceResearchPojo(retailPrice, retailCurrency, retailSource, retailCheckedAt, List.of(comparable));
  }

  public PriceResearchPojo withComparables(List<Comparable> newComparables) {
    return new PriceResearchPojo(retailPrice, retailCurrency, retailSource, retailCheckedAt, newComparables);
  }

  public PriceResearchPojo withoutRetailAnchor() {
    return new PriceResearchPojo(null, null, null, null, comparables);
  }

  public PriceResearchPojo withRetailPrice(Double newRetailPrice) {
    return new PriceResearchPojo(newRetailPrice, retailCurrency, retailSource, retailCheckedAt, comparables);
  }

  public PriceResearchPojo withRetailCheckedAt(String newRetailCheckedAt) {
    return new PriceResearchPojo(retailPrice, retailCurrency, retailSource, newRetailCheckedAt, comparables);
  }

  public PriceResearchPojo withTooManyComparables() {
    List<Comparable> many = IntStream.rangeClosed(1, COMPARABLES_LIMIT + 1)
        .mapToObj(i -> new Comparable(100.0 + i, "Advert " + i)).toList();
    return new PriceResearchPojo(retailPrice, retailCurrency, retailSource, retailCheckedAt, many);
  }

  // The body plus one extra top-level field, to check that the server refuses what it does not take.
  public Map<String, Object> withExtraField(String name, Object value) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("retailPrice", retailPrice);
    body.put("retailCurrency", retailCurrency);
    body.put("retailSource", retailSource);
    body.put("retailCheckedAt", retailCheckedAt);
    body.put("comparables", comparables);
    body.put(name, value);
    return body;
  }
}
