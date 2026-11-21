package dev.quokkify.marketdesk.test.api;

import java.time.Duration;

import dev.quokkify.annotation.SingleThread;
import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.test.BaseTest;

import org.testng.annotations.Test;

// The tests write the one file the app container reads from a read-only bind mount, so each runs alone.
// @SingleThread is method-level in q4j 0.16.0.
public class HermesLimitsTest extends BaseTest {

  private static final Duration STALE_AFTER = Duration.ofMinutes(20);
  private static final Duration CLOCK_AHEAD = Duration.ofMinutes(10);

  @SingleThread
  @Test
  public void freshLimitsShowPlanAndWindows() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeLimitsFetchedAgo(Duration.ZERO);
    hermesLimitsSteps.verify().areFreshWithPlanAndWindows(hermesLimitsSteps.getLimitsOnceReported(account, "fresh"));
  }

  @SingleThread
  @Test
  public void limitsAreTheSameForEveryWorkspace() {
    AccountPojo account = authSteps.registerNewAccount();
    AccountPojo other = authSteps.registerNewAccount();
    hermesLimitsSteps.writeLimitsFetchedAgo(Duration.ZERO);
    hermesLimitsSteps.verify().areFreshWithPlanAndWindows(hermesLimitsSteps.getLimitsOnceReported(account, "fresh"));
    hermesLimitsSteps.verify().areFreshWithPlanAndWindows(hermesLimitsSteps.getLimitsOnceReported(other, "fresh"));
  }

  @SingleThread
  @Test
  public void oldLimitsAreStale() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeLimitsFetchedAgo(STALE_AFTER);
    hermesLimitsSteps.verify().areStaleWithValues(hermesLimitsSteps.getLimitsOnceReported(account, "stale"));
  }

  @SingleThread
  @Test
  public void futureDatedLimitsAreUnknown() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeLimitsFetchedInFuture(CLOCK_AHEAD);
    hermesLimitsSteps.verify().areUnknown(hermesLimitsSteps.getLimitsOnceReported(account, "unknown"));
  }

  @SingleThread
  @Test
  public void brokenFileIsUnknown() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeBrokenFile();
    hermesLimitsSteps.verify().areUnknown(hermesLimitsSteps.getLimitsOnceReported(account, "unknown"));
  }

  @SingleThread
  @Test
  public void emptyFileIsUnknown() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeEmptyFile();
    hermesLimitsSteps.verify().areUnknown(hermesLimitsSteps.getLimitsOnceReported(account, "unknown"));
  }

  @SingleThread
  @Test
  public void missingFileIsUnknown() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.deleteFile();
    hermesLimitsSteps.verify().areUnknown(hermesLimitsSteps.getLimitsOnceReported(account, "unknown"));
  }

  @SingleThread
  @Test
  public void unavailableReasonIsUnknown() {
    AccountPojo account = authSteps.registerNewAccount();
    hermesLimitsSteps.writeUnavailable("fetch failed");
    hermesLimitsSteps.verify().areUnknownBecause(hermesLimitsSteps.getLimitsOnceReported(account, "unknown"), "fetch failed");
  }

  @SingleThread
  @Test
  public void limitsRequireLogin() {
    hermesLimitsSteps.verify().isUnauthenticated(hermesLimitsSteps.getLimitsUnauthenticated());
  }
}
