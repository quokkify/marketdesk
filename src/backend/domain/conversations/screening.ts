import { createHash } from 'node:crypto';
import {
  BARE_DOMAIN_TLDS,
  BASE64_BLOB_MIN_RUN,
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
const ZERO_WIDTH = /[​-‏⁠﻿]/g;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const BASE64_BLOB = new RegExp(`[A-Za-z0-9+/]{${BASE64_BLOB_MIN_RUN},}={0,2}`);
const URL_CANDIDATE =
  /(?:(https?):\/\/(?:[^\s/@]*@)?|(www\.))?((?:[a-z0-9-]+\.)+[a-z0-9-]+)(?::\d+)?(?:[/?#]\S*)?/g;
const DOT_WORD_PATTERN = new RegExp(`(?<=[\\p{L}\\p{N}-])\\s*[\\[(]?\\s*(?:${DOT_WORDS.join('|')})\\s*[\\])]?\\s*(?=[\\p{L}\\p{N}])`, 'gu');

function fold(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FOLDED_PHRASES = Object.fromEntries(
  Object.entries(PHRASES).map(([reason, phrases]) => [reason, phrases.map(fold)]),
) as Record<keyof typeof PHRASES, string[]>;

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
  return createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

function isOfficialHost(host: string): boolean {
  return OFFICIAL_OLX_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function hasForeignLink(text: string): boolean {
  const spelled = text.normalize('NFKC').toLowerCase().replace(DOT_WORD_PATTERN, '.');
  for (const match of spelled.matchAll(URL_CANDIDATE)) {
    const prefixed = Boolean(match[1] || match[2]);
    const host = match[3].replace(/\.+$/, '');
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (!prefixed && !BARE_DOMAIN_TLDS.includes(tld)) continue;
    if (!isOfficialHost(host)) return true;
  }
  return false;
}

function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= CARD_MIN_DIGITS && digits.length <= CARD_MAX_DIGITS && passesLuhn(digits)) return true;
  }
  return false;
}

function containsAny(folded: string, reason: keyof typeof PHRASES): boolean {
  return FOLDED_PHRASES[reason].some((p) => folded.includes(p));
}

export function screenBuyerMessage(input: ScreeningInput, limits: ScreeningLimits): { reasons: ScreeningReason[] } {
  const folded = fold(input.text);
  const lowered = input.text.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase();
  const reasons: ScreeningReason[] = [];

  if (hasForeignLink(input.text)) reasons.push('foreign_link');
  if (containsAny(folded, 'payment_data_request') || hasCardNumber(input.text)) reasons.push('payment_data_request');
  if (containsAny(folded, 'messenger_move')) reasons.push('messenger_move');
  if (containsAny(folded, 'fake_payment_confirmation')) reasons.push('fake_payment_confirmation');
  if (
    containsAny(folded, 'prompt_injection') ||
    ROLE_TAG_PATTERNS.some((p) => p.test(lowered)) ||
    BASE64_BLOB.test(input.text)
  ) {
    reasons.push('prompt_injection');
  }
  if (input.workspaceRepeatCount >= limits.repeatThreshold) reasons.push('repeated_text');
  if (input.threadMessagesLastHour >= limits.floodPerHour) reasons.push('message_flood');

  return { reasons };
}
