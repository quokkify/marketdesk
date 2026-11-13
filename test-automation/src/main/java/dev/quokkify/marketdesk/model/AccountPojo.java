package dev.quokkify.marketdesk.model;

public record AccountPojo(String email, String password, String token, String userId, String workspaceId) {

  // Allure prints step parameters with toString, and the report is published.
  @Override
  public String toString() {
    return "AccountPojo[email=" + email + ", userId=" + userId + ", workspaceId=" + workspaceId + "]";
  }
}
