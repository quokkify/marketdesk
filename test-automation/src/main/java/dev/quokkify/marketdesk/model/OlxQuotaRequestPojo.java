package dev.quokkify.marketdesk.model;

import java.time.Duration;
import java.time.Instant;

public record OlxQuotaRequestPojo(String subcategoryId, String cycleStartedAt, String cycleEndsAt,
    int publicationLimit, int consumed, String source, String confidence, String verifiedAt, String staleAt) {

  private static final Duration CYCLE_STARTED_AGO = Duration.ofDays(1);
  private static final Duration CYCLE_LENGTH = Duration.ofDays(30);
  private static final Duration FRESH_FOR = Duration.ofDays(1);

  // A verified, current cycle with every free publication used: the guard blocks with quota_exhausted.
  public static OlxQuotaRequestPojo exhausted(String subcategoryId, Instant now) {
    return new OlxQuotaRequestPojo(subcategoryId, now.minus(CYCLE_STARTED_AGO).toString(),
        now.plus(CYCLE_LENGTH).toString(), 1, 1, "operator", "verified", now.toString(),
        now.plus(FRESH_FOR).toString());
  }
}
