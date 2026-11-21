// Parses a model answer as a JSON object, tolerating the fenced code block models may wrap it in.
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    const value = JSON.parse(candidate);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
