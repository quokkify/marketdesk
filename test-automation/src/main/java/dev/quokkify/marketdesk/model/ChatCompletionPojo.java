package dev.quokkify.marketdesk.model;

import java.util.List;

import dev.quokkify.util.JsonConverter;

// The smallest OpenAI-style chat completion a Hermes profile answers with: one assistant message.
public record ChatCompletionPojo(String object, List<Choice> choices) {

  private static final String CHAT_COMPLETION = "chat.completion";
  private static final String ASSISTANT = "assistant";

  public record Choice(int index, Message message) {
  }

  public record Message(String role, String content) {
  }

  public static ChatCompletionPojo answering(String content) {
    return new ChatCompletionPojo(CHAT_COMPLETION, List.of(new Choice(0, new Message(ASSISTANT, content))));
  }

  // The buyer-queries answer the listing response graph expects: {"queries": [...]}.
  public static ChatCompletionPojo queries(List<String> queries) {
    return answering(JsonConverter.toJson(new QueriesAnswer(queries)));
  }

  public String toJson() {
    return JsonConverter.toJson(this);
  }

  private record QueriesAnswer(List<String> queries) {
  }
}
