package dev.quokkify.marketdesk.helper;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import dev.quokkify.marketdesk.config.MarketDeskDbConfig;
import dev.quokkify.persistence.PersistenceConfigurationFactory;

import org.hibernate.SessionFactory;
import org.hibernate.cfg.AvailableSettings;

// Puts rows into states the API cannot reach on the stub stack, such as an advert that expired on OLX.
// The password goes only into the connection settings, never into a step parameter or a log line.
public class DatabaseHelper {

  private static final String EXPIRE_LISTING = "UPDATE listings SET status = 'expired', marketplace_listing_id = :advertId"
      + " WHERE id = :listingId";

  public void markListingExpired(String listingId, String advertId) {
    // fromTransaction opens a session for this call only, commits or rolls back, and closes it.
    int updated = Connection.FACTORY.fromTransaction(session -> session.createNativeMutationQuery(EXPIRE_LISTING)
        .setParameter("advertId", advertId)
        .setParameter("listingId", UUID.fromString(listingId))
        .executeUpdate());
    if (updated != 1) {
      throw new IllegalStateException("Listing " + listingId + " was not found in the database");
    }
  }

  // One factory, and so one connection pool, for the whole test JVM, built on first use: tests that never touch
  // the database never connect.
  private static final class Connection {

    private static final SessionFactory FACTORY = PersistenceConfigurationFactory
        .create("marketdesk", Map.of(
            AvailableSettings.JAKARTA_JDBC_URL, MarketDeskDbConfig.URL,
            AvailableSettings.JAKARTA_JDBC_USER, MarketDeskDbConfig.USER,
            AvailableSettings.JAKARTA_JDBC_PASSWORD, MarketDeskDbConfig.PASSWORD), List.of())
        .createEntityManagerFactory()
        .unwrap(SessionFactory.class);

    private Connection() {
    }
  }
}
