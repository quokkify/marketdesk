import { createHash } from 'node:crypto';
import {
  BARE_DOMAIN_TLDS,
  BASE64_BLOB_MIN_RUN,
  CYRILLIC_CONFUSABLES,
  DOT_WORDS,
  OFFICIAL_OLX_DOMAINS,
  PHRASES,
  ROLE_TAG_PATTERNS,
} from './screeningRules';
import type { ScreeningReason } from './types';

export interface ScreeningInput {
  text: string;
  workspaceRepeatCount: number;
  threadMessagesLastHour: number;
}

export interface ScreeningLimits {
  repeatThreshold: number;
  floodPerHour: number;
}

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/g;
const CARD_RUN = /\d+(?:[ -]\d+)*/g;
const BASE64_BLOB = new RegExp(`[A-Za-z0-9+/]{${BASE64_BLOB_MIN_RUN},}={0,2}`);
const LABEL = '[\\p{L}\\p{N}_-]+';
const SCHEME_URL = /\bhttps?:\/\/(?:[^\s/@?#]*@)?(\[[^\]\s]*\]|[^\s/:?#]+)(?::\d+)?(?:[/?#]\S*)?/giu;
const BARE_URL = new RegExp(`(?<![\\p{L}\\p{N}@._-])(${LABEL}(?:\\.${LABEL})+)(?::\\d+)?(/\\S*)?`, 'giu');
const DOT_WORD_PATTERN = new RegExp(
  `(?<=[\\p{L}\\p{N}-])\\s*[\\[(]?\\s*(?:${DOT_WORDS.join('|')})\\s*[\\])]?\\s*(?=[\\p{L}\\p{N}])`,
  'giu',
);
const BRACKETED_DOT = /[[({]\s*\.\s*[\])}]/g;
const SPACED_DOT = /(?<=[\p{L}\p{N}-])[ \t]+\.[ \t]+(?=[\p{L}\p{N}])/gu;
const SPACED_LETTERS = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][\s.\-_*]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;
const INNER_SEPARATORS = /(?<=\p{L})[.\-_*]+(?=\p{L})/gu;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const ASCII_HOST = /^[a-z0-9.-]+$/;

export function stripZeroWidth(text: string): string {
  return text.normalize('NFKC').replace(ZERO_WIDTH, '');
}

export function fold(text: string, zeroWidthAs = ' '): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH, zeroWidthAs)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function latinFold(text: string): string {
  let out = '';
  for (const ch of text) out += CYRILLIC_CONFUSABLES[ch] ?? ch;
  return out;
}

export function joinObfuscated(folded: string): string {
  return folded
    .replace(SPACED_LETTERS, (m) => m.replace(/[\s.\-_*]+/g, ''))
    .replace(INNER_SEPARATORS, '');
}

function compilePhrase(phrase: string): { regex: RegExp; cyrillic: boolean } {
  const folded = fold(phrase);
  const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    regex: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u'),
    cyrillic: CYRILLIC.test(folded),
  };
}

const COMPILED_PHRASES = Object.fromEntries(
  Object.entries(PHRASES).map(([reason, phrases]) => [reason, phrases.map(compilePhrase)]),
) as Record<keyof typeof PHRASES, Array<{ regex: RegExp; cyrillic: boolean }>>;

export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function normalizedTextHash(text: string): string {
  const canonical = latinFold(stripZeroWidth(text).toLowerCase()).replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(canonical).digest('hex');
}

function isOfficialHost(host: string): boolean {
  return ASCII_HOST.test(host) && OFFICIAL_OLX_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function isSentenceTypo(label: string, tldOriginal: string, hasPath: boolean): boolean {
  return (
    !hasPath &&
    /^\p{Lu}/u.test(tldOriginal) &&
    tldOriginal !== tldOriginal.toUpperCase() &&
    !/[\p{N}-]/u.test(label)
  );
}

export function hasForeignLink(clean: string, allowOfficial = true): boolean {
  let text = clean
    .replace(/hxxp(s?):\/\//gi, 'http$1://')
    .replace(BRACKETED_DOT, '.')
    .replace(DOT_WORD_PATTERN, '.')
    .replace(SPACED_DOT, '.');

  for (const match of text.matchAll(SCHEME_URL)) {
    const host = match[1].toLowerCase().replace(/\.+$/, '');
    if (host && !(allowOfficial && isOfficialHost(host))) return true;
  }
  text = text.replace(SCHEME_URL, ' ');

  for (const match of text.matchAll(BARE_URL)) {
    const hostOriginal = match[1].replace(/\.+$/, '');
    const host = hostOriginal.toLowerCase();
    const hasPath = Boolean(match[2]);
    const labels = host.split('.');
    const tld = labels[labels.length - 1];
    const label = labels[labels.length - 2];
    if (IPV4.test(host)) return true;
    if (allowOfficial && isOfficialHost(host)) continue;
    if (labels.includes('olx')) return true;
    if (host.startsWith('www.') || (hasPath && /^\p{L}{2,}$/u.test(tld))) return true;
    const tldOriginal = hostOriginal.slice(hostOriginal.lastIndexOf('.') + 1);
    if (isSentenceTypo(label, tldOriginal, hasPath)) continue;
    const knownTld = BARE_DOMAIN_TLDS.includes(tld) || BARE_DOMAIN_TLDS.includes(latinFold(tld));
    const suspiciousLabel = /^\p{L}{2,}$/u.test(tld) && /[\p{N}-]/u.test(labels.slice(0, -1).join('.'));
    if (knownTld || suspiciousLabel) return true;
  }
  return false;
}

export function hasCardNumber(text: string): boolean {
  for (const run of text.matchAll(CARD_RUN)) {
    const groups = run[0].split(/[ -]/);
    for (let i = 0; i < groups.length; i += 1) {
      let digits = '';
      for (let j = i; j < groups.length; j += 1) {
        digits += groups[j];
        if (digits.length > CARD_MAX_DIGITS) break;
        if (digits.length >= CARD_MIN_DIGITS && passesLuhn(digits)) return true;
      }
    }
  }
  return false;
}

function containsAny(views: { plain: string; latin: string }[], reason: keyof typeof PHRASES): boolean {
  return COMPILED_PHRASES[reason].some(({ regex, cyrillic }) =>
    views.some((v) => regex.test(cyrillic ? v.plain : v.latin)),
  );
}

export function screenBuyerMessage(input: ScreeningInput, limits: ScreeningLimits): { reasons: ScreeningReason[] } {
  const clean = stripZeroWidth(input.text);
  const spaced = fold(input.text, ' ');
  const joined = joinObfuscated(fold(input.text, ''));
  const views = [spaced, joined].map((plain) => ({ plain, latin: latinFold(plain) }));
  const lowered = clean.toLowerCase();
  const reasons: ScreeningReason[] = [];

  if (hasForeignLink(clean)) reasons.push('foreign_link');
  if (containsAny(views, 'payment_data_request') || hasCardNumber(clean)) reasons.push('payment_data_request');
  if (containsAny(views, 'messenger_move')) reasons.push('messenger_move');
  if (containsAny(views, 'fake_payment_confirmation')) reasons.push('fake_payment_confirmation');
  if (
    containsAny(views, 'prompt_injection') ||
    ROLE_TAG_PATTERNS.some((p) => p.test(lowered) || p.test(latinFold(lowered))) ||
    BASE64_BLOB.test(clean)
  ) {
    reasons.push('prompt_injection');
  }
  if (input.workspaceRepeatCount >= limits.repeatThreshold) reasons.push('repeated_text');
  if (input.threadMessagesLastHour >= limits.floodPerHour) reasons.push('message_flood');

  return { reasons };
}
