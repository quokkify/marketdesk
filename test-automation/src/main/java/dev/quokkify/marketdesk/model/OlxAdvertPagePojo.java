package dev.quokkify.marketdesk.model;

import java.util.UUID;

import dev.quokkify.util.JsonConverter;

// A synthetic public OLX advert page: only the delivery mode the app reads from window.__PRERENDERED_STATE__
// (ad.ad.delivery.rock.mode). No title, seller or other page content, real or invented.
public record OlxAdvertPagePojo(Ad ad) {

  // The app takes only the path of an advert URL and asks the stand's OLX_SEARCH_BASE_URL host for it.
  private static final String ADVERT_URL = "https://www.olx.pl/d/oferta/%s.html";
  private static final String ADVERT_PATH = "/d/oferta/%s.html";
  private static final String PAGE_HEAD = "<html><body><script>\n window.__PRERENDERED_STATE__= ";
  private static final String PAGE_TAIL = ";\n</script></body></html>";

  public record Ad(AdDetails ad) {
  }

  public record AdDetails(Delivery delivery) {
  }

  public record Delivery(Rock rock) {
  }

  public record Rock(String mode) {
  }

  // A slug no other test uses, so the page a test registers on the shared mock is its own.
  public static String newSlug() {
    return "qa-advert-" + UUID.randomUUID();
  }

  public static String advertUrl(String slug) {
    return ADVERT_URL.formatted(slug);
  }

  public static String advertPath(String slug) {
    return ADVERT_PATH.formatted(slug);
  }

  public static OlxAdvertPagePojo withDeliveryMode(String mode) {
    return new OlxAdvertPagePojo(new Ad(new AdDetails(new Delivery(new Rock(mode)))));
  }

  // The page embeds its state as a JSON string literal, so the state is serialized twice.
  public String toHtml() {
    return PAGE_HEAD + JsonConverter.toJson(JsonConverter.toJson(this)) + PAGE_TAIL;
  }
}
