package dev.quokkify.marketdesk.helper;

import java.util.UUID;

import dev.quokkify.marketdesk.model.AccountPojo;
import dev.quokkify.marketdesk.model.RegistrationPojo;
import dev.quokkify.marketdesk.service.AuthService;

import io.restassured.path.json.JsonPath;
import org.apache.http.HttpStatus;

public class AccountHelper {

  private static final String EMAIL_PREFIX = "qa-";
  private static final String EMAIL_DOMAIN = "@example.test";
  private static final String PASSWORD = "Passw0rd-qa1";

  private final AuthService service = new AuthService();

  public AccountPojo registerNewAccount() {
    String email = EMAIL_PREFIX + UUID.randomUUID() + EMAIL_DOMAIN;
    JsonPath body = service.register(new RegistrationPojo(email, PASSWORD, null))
        .statusCode(HttpStatus.SC_CREATED)
        .extract()
        .jsonPath();
    return new AccountPojo(email, PASSWORD, body.getString("data.token"), body.getString("data.user.id"),
        body.getString("data.user.workspaceId"));
  }
}
