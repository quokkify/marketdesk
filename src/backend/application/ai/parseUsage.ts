// Token counts from the `usage` block of an OpenAI-compatible chat completion body. A count that
// is not a non-negative safe integer is unknown (null), never a guessed number or 0.

export interface ParsedUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseUsage(body: unknown): ParsedUsage {
  const usage =
    typeof body === 'object' && body !== null ? (body as { usage?: unknown }).usage : undefined;
  const counts =
    typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>) : {};
  return {
    promptTokens: tokenCount(counts.prompt_tokens),
    completionTokens: tokenCount(counts.completion_tokens),
    totalTokens: tokenCount(counts.total_tokens),
  };
}
