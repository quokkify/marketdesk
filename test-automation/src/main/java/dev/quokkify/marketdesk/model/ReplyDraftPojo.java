package dev.quokkify.marketdesk.model;

// A pending reply draft as the conversations view shows it.
public record ReplyDraftPojo(String threadId, String draftId, String text) {
}
