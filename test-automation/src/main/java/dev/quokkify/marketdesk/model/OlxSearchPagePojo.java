package dev.quokkify.marketdesk.model;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.LongStream;

import dev.quokkify.util.JsonConverter;

import com.fasterxml.jackson.annotation.JsonProperty;

// A synthetic public OLX search page: only the fields the app reads from window.__PRERENDERED_STATE__ (ids,
// promotion, regular price, totals). No titles, sellers or other page content, real or invented.
public record OlxSearchPagePojo(State listing) {

  private static final String ORGANIC = "organic";
  private static final String PLN = "PLN";
  private static final double CARD_PRICE = 150.0;
  private static final long ADVERT_ID_FLOOR = 900_000_000L;
  private static final long ADVERT_ID_SPAN = 90_000_000L;
  private static final String PAGE_HEAD = "<html><body><script>\n window.__PRERENDERED_STATE__= ";
  private static final String PAGE_TAIL = ";\n window.__TAURUS__= [];\n</script></body></html>";

  public record State(Listing listing) {
  }

  public record Listing(int totalElements, int totalPages, List<Ad> ads) {
  }

  // Named explicitly: a boolean component that starts with "is" must keep that prefix in the JSON.
  public record Ad(long id, String searchReason, @JsonProperty("isPromoted") boolean isPromoted, Price price) {
  }

  public record Price(RegularPrice regularPrice) {
  }

  public record RegularPrice(double value, String currencyCode) {
  }

  // A numeric OLX advert id that no other test uses; the app finds its own advert among the cards by this id.
  public static String newAdvertId() {
    return String.valueOf(ADVERT_ID_FLOOR + ThreadLocalRandom.current().nextLong(ADVERT_ID_SPAN));
  }

  // Organic cards of other sellers, priced above the sample listing so they add no price finding; ids start at
  // firstId, which keeps them apart from newAdvertId().
  public static List<Ad> otherAdverts(long firstId, int count) {
    return LongStream.range(firstId, firstId + count).mapToObj(OlxSearchPagePojo::organic).toList();
  }

  public static Ad organic(long id) {
    return new Ad(id, ORGANIC, false, new Price(new RegularPrice(CARD_PRICE, PLN)));
  }

  public static OlxSearchPagePojo page(int totalElements, int totalPages, List<Ad> ads) {
    return new OlxSearchPagePojo(new State(new Listing(totalElements, totalPages, ads)));
  }

  // otherCount organic cards of other sellers, then the advert with ownAdvertId as the next organic card.
  public static OlxSearchPagePojo pageEndingWith(int totalElements, int totalPages, long firstOtherId,
      int otherCount, String ownAdvertId) {
    List<Ad> ads = new ArrayList<>(otherAdverts(firstOtherId, otherCount));
    ads.add(organic(Long.parseLong(ownAdvertId)));
    return page(totalElements, totalPages, ads);
  }

  // The page embeds its state as a JSON string literal, so the state is serialized twice.
  public String toHtml() {
    return PAGE_HEAD + JsonConverter.toJson(JsonConverter.toJson(this)) + PAGE_TAIL;
  }
}
