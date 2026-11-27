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
  // The columns are TIMESTAMP without a zone and the app reads them as UTC, so the times are written in UTC whatever
  // zone the JDBC session has. Watchers and conversations are 0, not unknown, as after an OLX sync.
  private static final String LIVE_LISTING = "UPDATE listings SET status = 'live', marketplace_listing_id = :advertId,"
      + " published_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :hoursLive),"
      + " last_sync_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', views = :views, watchers = 0, conversations = 0"
      + " WHERE id = :listingId";
  // The public page URL and the verified category a live advert's sync would have stored.
  private static final String ADVERT_PAGE = "UPDATE listings SET external_url = :externalUrl,"
      + " marketplace_category = CAST(:category AS jsonb) WHERE id = :listingId";

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

  // A live OLX advert published hoursLive hours ago and synced just now with the given total views.
  public void markListingLive(String listingId, String advertId, int hoursLive, int views) {
    int updated = Connection.FACTORY.fromTransaction(session -> session.createNativeMutationQuery(LIVE_LISTING)
        .setParameter("advertId", advertId)
        .setParameter("hoursLive", hoursLive)
        .setParameter("views", views)
        .setParameter("listingId", UUID.fromString(listingId))
        .executeUpdate());
    if (updated != 1) {
      throw new IllegalStateException("Listing " + listingId + " was not found in the database");
    }
  }

  // The category is the JSON of a MarketplaceCategoryMetadata.
  public void setListingAdvertPage(String listingId, String externalUrl, String categoryJson) {
    int updated = Connection.FACTORY.fromTransaction(session -> session.createNativeMutationQuery(ADVERT_PAGE)
        .setParameter("externalUrl", externalUrl)
        .setParameter("category", categoryJson)
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
