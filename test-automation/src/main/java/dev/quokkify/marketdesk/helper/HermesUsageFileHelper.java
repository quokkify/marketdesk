package dev.quokkify.marketdesk.helper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import dev.quokkify.marketdesk.config.MarketDeskApiConfig;

// Writes the file that `hermes usage --json` leaves in the directory the app container reads (read-only).
public class HermesUsageFileHelper {

  private static final String FILE_NAME = "usage.json";
  private static final String WINDOWS = "\"windows\":[{\"label\":\"Session\",\"used_percent\":4.0,"
      + "\"resets_at\":\"2026-11-21T20:29:41+00:00\",\"detail\":null},{\"label\":\"Weekly\",\"used_percent\":10.0,"
      + "\"resets_at\":\"2026-11-25T09:30:00+00:00\",\"detail\":null}]";
  private static final String DETAILS = "\"details\":[\"Credits: 12\","
      + "\"You have 3 resets banked - use /usage reset to activate\"]";

  private final Path dir = Path.of(MarketDeskApiConfig.HERMES_USAGE_DIR);

  public void writeLimits(Instant fetchedAt) {
    writeRaw("{\"provider\":\"openai-codex\",\"source\":\"usage_api\",\"title\":\"Account limits\","
        + "\"plan\":\"Plus\",\"fetched_at\":\"" + fetchedAt.truncatedTo(ChronoUnit.SECONDS) + "\"," + WINDOWS + ","
        + DETAILS + ",\"unavailable_reason\":null}");
  }

  public void writeUnavailable(String reason, Instant fetchedAt) {
    writeRaw("{\"unavailable_reason\":\"" + reason + "\",\"fetched_at\":\"" + fetchedAt.truncatedTo(ChronoUnit.SECONDS)
        + "\"}");
  }

  public void writeRaw(String content) {
    try {
      Files.createDirectories(dir);
      Files.writeString(dir.resolve(FILE_NAME), content, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("Cannot write the Hermes usage fixture into " + dir, e);
    }
  }

  public void deleteFile() {
    try {
      Files.deleteIfExists(dir.resolve(FILE_NAME));
    } catch (IOException e) {
      throw new UncheckedIOException("Cannot delete the Hermes usage fixture in " + dir, e);
    }
  }
}
