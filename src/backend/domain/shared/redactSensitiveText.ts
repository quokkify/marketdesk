// Removes secrets from error text before it reaches a log: every configured sensitive value,
// every URL (a connection string or an endpoint can carry credentials) and password=... pairs.
export function redactSensitiveText(
  text: string,
  sensitiveValues: readonly (string | undefined)[] = [],
): string {
  let result = text;
  const values = sensitiveValues
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length);

  for (const value of values) {
    result = result.split(value).join('[redacted]');
  }

  return result
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi, '[redacted-connection-string]')
    .replace(/\b(password|pass|pwd)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
}
