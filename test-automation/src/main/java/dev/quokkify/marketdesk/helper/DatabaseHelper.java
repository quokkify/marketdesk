package dev.quokkify.marketdesk.helper;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import dev.quokkify.marketdesk.config.MarketDeskDbConfig;
import dev.quokkify.persistence.PersistenceConfigurationFactory;
import dev.quokkify.service.DatabaseService;

import org.hibernate.Session;
import org.hibernate.cfg.AvailableSettings;

// Puts rows into states the API cannot reach on the stub stack, such as an advert that expired on OLX.
// The password goes only into the connection settings, never into a step parameter or a log line.
public class DatabaseHelper {

  private static final String PERSISTENCE_NAME = "marketdesk";
  private static final String EXPIRE_LISTING = "UPDATE listings SET status = 'expired', marketplace_listing_id = :advertId"
      + " WHERE id = :listingId";

  public void markListingExpired(String listingId, String advertId) {
    Session session = session();
    session.getTransaction().begin();
    try {
      int updated = session.createNativeMutationQuery(EXPIRE_LISTING)
          .setParameter("advertId", advertId)
          .setParameter("listingId", UUID.fromString(listingId))
          .executeUpdate();
      session.getTransaction().commit();
      if (updated != 1) {
        throw new IllegalStateException("Listing " + listingId + " was not found in the database");
      }
    } catch (RuntimeException e) {
      if (session.getTransaction().isActive()) {
        session.getTransaction().rollback();
      }
      throw e;
    }
  }

  private Session session() {
    Map<String, Object> properties = Map.of(
        AvailableSettings.JAKARTA_JDBC_URL, MarketDeskDbConfig.URL,
        AvailableSettings.JAKARTA_JDBC_USER, MarketDeskDbConfig.USER,
        AvailableSettings.JAKARTA_JDBC_PASSWORD, MarketDeskDbConfig.PASSWORD);
    return DatabaseService.getInstance()
        .createSqlQuery(PersistenceConfigurationFactory.create(PERSISTENCE_NAME, properties, List.of()))
        .getSession();
  }
}
