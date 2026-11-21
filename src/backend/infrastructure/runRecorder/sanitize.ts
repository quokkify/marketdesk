import { describeError } from '../../application/runs/describeError';
import { SecretRegistry, secretRegistry } from './SecretRegistry';

declare const sanitizedBrand: unique symbol;
export type Sanitized<T> = T & { readonly [sanitizedBrand]: true };

export const MAX_STRING_LENGTH = 4096;
export const MAX_LINE_BYTES = 65536;
export const MAX_SECRET_SCAN_MARGIN = 4096;
const MAX_SCAN_LENGTH = MAX_STRING_LENGTH + MAX_SECRET_SCAN_MARGIN;
const MAX_DEPTH = 8;
const ERROR_INFO_STRING_FIELDS = new Set(['name', 'message', 'code', 'at']);
const PG_STRING_FIELDS = new Set(['code', 'constraint', 'table']);

const DENIED_KEY_PARTS = [
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'refresh',
  'credential',
  'apikey',
];
const DENIED_KEYS = new Set(['code', 'state', 'clientid', 'key', 'apikey']);

const BEARER = /Bearer\s+\S+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{40,}/g;
const URL_QUERY = /(\/[^\s?#]{0,2048})\?[^\s#]+/g;
const SENSITIVE_PAIR =
  /\b((?:[\w-]{0,256}token[\w-]{0,256}|code|state|client_secret|password)=)[^&\s]*/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/gi;

function isDeniedKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return DENIED_KEYS.has(lower) || DENIED_KEY_PARTS.some((part) => lower.includes(part));
}

function sanitizeString(original: string, registry: SecretRegistry): string {
  // A secret that starts inside the kept MAX_STRING_LENGTH is seen whole; one longer than the margin is out of scope.
  const text = original.length > MAX_SCAN_LENGTH ? original.slice(0, MAX_SCAN_LENGTH) : original;
  const cleaned = registry
    .scrub(text)
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(SENSITIVE_PAIR, '$1[REDACTED]')
    .replace(JWT, '[REDACTED:jwt]')
    .replace(LONG_TOKEN, '[REDACTED:token]')
    .replace(URL_QUERY, '$1?[REDACTED]')
    .replace(URL_USERINFO, '$1');
  const unscanned = original.length - text.length;
  if (cleaned.length <= MAX_STRING_LENGTH && unscanned === 0) return cleaned;
  const dropped = Math.max(cleaned.length - MAX_STRING_LENGTH, 0) + unscanned;
  return `${cleaned.slice(0, MAX_STRING_LENGTH)}…[truncated ${dropped} chars]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function walkPg(
  pg: Record<string, unknown>,
  registry: SecretRegistry,
  depth: number,
  ancestors: Set<object>
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) return { '[MaxDepth]': true };
  ancestors.add(pg);
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(pg)) {
    if (PG_STRING_FIELDS.has(key) && typeof child === 'string') {
      copy[key] = sanitizeString(child, registry);
    } else if (isDeniedKey(key)) {
      copy[key] = '[REDACTED:key]';
    } else {
      copy[key] = walk(child, registry, depth + 1, ancestors, true);
    }
  }
  ancestors.delete(pg);
  return copy;
}

function walk(
  value: unknown,
  registry: SecretRegistry,
  depth: number,
  ancestors: Set<object>,
  denyKeys = true,
  asErrorInfo = false
): unknown {
  if (typeof value === 'string') return sanitizeString(value, registry);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return sanitizeString(String(value), registry);
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[Binary ${value.byteLength} bytes]`;
  }
  if (ancestors.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  const isError = value instanceof Error;
  const isErrorInfo = isError || asErrorInfo;
  const source = isError ? describeError(value) : value;
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(source)) {
    result = source.map((item) => walk(item, registry, depth + 1, ancestors, denyKeys));
  } else {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (isErrorInfo && ERROR_INFO_STRING_FIELDS.has(key) && typeof child === 'string') {
        copy[key] = sanitizeString(child, registry);
      } else if (isErrorInfo && key === 'pg' && isPlainObject(child) && !ancestors.has(child)) {
        copy[key] = walkPg(child, registry, depth + 1, ancestors);
      } else if (isErrorInfo) {
        copy[key] = isDeniedKey(key)
          ? '[REDACTED:key]'
          : walk(child, registry, depth + 1, ancestors, true);
      } else if (denyKeys && isDeniedKey(key)) {
        copy[key] = '[REDACTED:key]';
      } else {
        copy[key] = walk(child, registry, depth + 1, ancestors, denyKeys);
      }
    }
    result = copy;
  }
  ancestors.delete(value);
  return result;
}

export interface SanitizeOptions {
  errorInfoKeys?: readonly string[];
}

export function sanitize<T>(
  value: T,
  registry: SecretRegistry = secretRegistry,
  options?: SanitizeOptions
): Sanitized<T> {
  const errorInfoKeys = options?.errorInfoKeys;
  if (!errorInfoKeys?.length || !isPlainObject(value)) {
    return walk(value, registry, 0, new Set()) as Sanitized<T>;
  }
  const ancestors = new Set<object>([value]);
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isDeniedKey(key)) {
      copy[key] = '[REDACTED:key]';
    } else {
      const errorInfo = errorInfoKeys.includes(key) && isPlainObject(child);
      copy[key] = walk(child, registry, 1, ancestors, true, errorInfo);
    }
  }
  return copy as Sanitized<T>;
}

export function serializeLine(value: Sanitized<unknown>): string {
  let line = JSON.stringify(value);
  if (Buffer.byteLength(line) <= MAX_LINE_BYTES) return line;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return line;

  const fields: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const omitted = new Set<string>();
  while (Buffer.byteLength(line) > MAX_LINE_BYTES && omitted.size < Object.keys(fields).length) {
    let largestKey: string | undefined;
    let largestSize = -1;
    for (const [key, field] of Object.entries(fields)) {
      if (omitted.has(key)) continue;
      const size = Buffer.byteLength(JSON.stringify(field) ?? '');
      if (size > largestSize) {
        largestSize = size;
        largestKey = key;
      }
    }
    if (largestKey === undefined) break;
    fields[largestKey] = `[omitted: ${largestSize} bytes]`;
    omitted.add(largestKey);
    line = JSON.stringify(fields);
  }
  return line;
}
