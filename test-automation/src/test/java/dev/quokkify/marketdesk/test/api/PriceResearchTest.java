package dev.quokkify.marketdesk.test.api;

import java.util.List;
import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.PriceResearchPojo;
import dev.quokkify.marketdesk.model.ProductListingPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

public class PriceResearchTest extends BaseTest {

  @Test
  public void savedPriceResearchIsReturned() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research);
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(account, productId), research);
  }

  @Test
  public void clearingRetailAnchorStoresNull() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research);
    priceResearchSteps.savePriceResearch(account, productId, research.withoutRetailAnchor());
    priceResearchSteps.verify().hasNoRetailAnchor(priceResearchSteps.getPriceResearch(account, productId));
  }

  @Test
  public void webComparableWithOlxUrlIsSaved() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo.Comparable comparable = new PriceResearchPojo.Comparable(250.0, "AirPods 4",
        "https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-ID1d1eUB.html", "web");
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withComparable(comparable)));
    priceResearchSteps.verify().keepsComparableLink(priceResearchSteps.getPriceResearch(account, productId), comparable);
  }

  @Test
  public void webComparableWithForeignUrlIsRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withComparable(new PriceResearchPojo.Comparable(250.0, "AirPods 4",
            "https://evil.example/d/oferta/a-CID99-ID1a.html", "web"))));
  }

  @Test
  public void manualComparableWithoutUrlStillWorks() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productId, research));
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(account, productId), research);
  }

  @Test
  public void negativeRetailPriceIsRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withRetailPrice(-1.0)));
  }

  @Test
  public void retailCheckedAtWithAnInvalidMonthIsRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withRetailCheckedAt("2026-13-45")));
  }

  // Beyond what the NUMERIC(12,2) column holds.
  @Test
  public void retailPriceAboveTheStoredMaximumIsRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withRetailPrice(1e13)));
  }

  @Test
  public void thirtyOneComparablesAreRejected() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withTooManyComparables()));
  }

  @Test
  public void otherWorkspaceCannotReadOrWritePriceResearch() {
    AccountPojo owner = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(owner);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(owner, productId, research);
    AccountPojo stranger = authSteps.registerNewAccount();
    priceResearchSteps.verify().isNotFound(priceResearchSteps.getPriceResearch(stranger, productId));
    priceResearchSteps.verify().isNotFound(
        priceResearchSteps.savePriceResearch(stranger, productId, research.withRetailPrice(1.0)));
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(owner, productId), research);
  }

  @Test
  public void priceResearchRequiresLogin() {
    String productId = UUID.randomUUID().toString();
    priceResearchSteps.verify().isUnauthenticated(priceResearchSteps.getPriceResearchUnauthenticated(productId));
    priceResearchSteps.verify().isUnauthenticated(
        priceResearchSteps.savePriceResearchUnauthenticated(productId, PriceResearchPojo.sample()));
  }

  // The API stack has no Hermes, so the analysis runs offline and its estimate has low confidence.
  @Test
  public void analysisWithoutHermesProposesNoPriceChange() {
    AccountPojo account = authSteps.registerNewAccount();
    marketplaceSteps.connectSandboxOlx(account);
    ProductListingPojo productListing = listingSteps.createOlxProductListing(account);
    priceResearchSteps.savePriceResearch(account, productListing.productId(), PriceResearchPojo.sample());
    priceResearchSteps.verify().proposesNoPriceChange(
        priceResearchSteps.runProductAnalysis(account, productListing.productId()));
  }

  private static final String ALLEGRO_OFFER = "https://allegro.pl/oferta/projektor-123";

  @Test
  public void putAcceptsAutoRowWithTier() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo.Comparable comparable = new PriceResearchPojo.Comparable(300.0, "Projector",
        ALLEGRO_OFFER + "?bi_s=x", "auto", "substitute_new", "2026-11-20");
    priceResearchSteps.verify().isSaved(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withComparable(comparable)));
    priceResearchSteps.verify().keepsAutoComparable(priceResearchSteps.getPriceResearch(account, productId), comparable);
  }

  @Test
  public void deletingAutoRowRecordsDismissal() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo.Comparable comparable = new PriceResearchPojo.Comparable(300.0, "Projector",
        ALLEGRO_OFFER + "?bi_s=x", "auto", "substitute_new", "2026-11-20");
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research.withComparable(comparable));
    priceResearchSteps.savePriceResearch(account, productId, research);
    priceResearchSteps.verify().hasDismissed(priceResearchSteps.getPriceResearch(account, productId), ALLEGRO_OFFER);
  }

  @Test
  public void autoRowOnUnknownHostIs400() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withComparable(new PriceResearchPojo.Comparable(300.0, "Projector",
            "https://evil.example/allegro.pl", "auto", "substitute_new", "2026-11-20"))));
  }

  // A form opened before another save (or an analysis) must not overwrite what that save stored.
  @Test
  public void staleBaseUpdatedAtIs409() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    PriceResearchPojo research = PriceResearchPojo.sample();
    priceResearchSteps.savePriceResearch(account, productId, research);
    String openedAt = priceResearchSteps.priceResearchUpdatedAt(account, productId);
    priceResearchSteps.verify().isSaved(
        priceResearchSteps.savePriceResearchFrom(account, productId, research.withRetailPrice(450.0), openedAt));
    priceResearchSteps.verify().isStale(
        priceResearchSteps.savePriceResearchFrom(account, productId, research.withRetailPrice(400.0), openedAt));
    priceResearchSteps.verify().holds(priceResearchSteps.getPriceResearch(account, productId),
        research.withRetailPrice(450.0));
  }

  @Test
  public void dismissedUrlsInBodyIs400() {
    AccountPojo account = authSteps.registerNewAccount();
    String productId = priceResearchSteps.createProduct(account);
    priceResearchSteps.verify().isInvalid(priceResearchSteps.savePriceResearch(account, productId,
        PriceResearchPojo.sample().withExtraField("dismissedUrls", List.of(ALLEGRO_OFFER))));
  }
}
