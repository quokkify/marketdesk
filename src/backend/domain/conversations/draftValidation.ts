import {
  fold,
  hasCardNumber,
  hasForeignLink,
  joinObfuscated,
  latinFold,
  stripZeroWidth,
} from './screening';

export type DraftRule =
  | 'below_floor'
  | 'link'
  | 'contact'
  | 'iban'
  | 'off_platform_payment'
  | 'too_long'
  | 'unfilled_placeholder'
  | 'empty';

export const PRICE_PLACEHOLDER = '{{PRICE}}';
export const MAX_REPLY_LENGTH = 1000;

const PHONE_MIN_DIGITS = 9;
const BASE_CURRENCIES = ['zł', 'zl', 'pln', 'грн', 'uah', '€', 'eur'];
const PRICE_WORDS = ['cena', 'ціна', 'цена', 'price'];
const PRICE_WORD_WINDOW = 3;
const NUMBER = '\\d+(?:[.,]\\d{1,2})?';
const PHONE_RUN = /\+?\d(?:[ -]?\d)+/g;
const EMAIL = /[^\s@]+@[^\s@]+\.\p{L}{2,}/u;
const ADDRESS = /(?<![\p{L}])(?:(?:ul|вул|ул)\.|ulica\s)\s*\p{L}/iu;
const IBAN = /(?<![\p{L}\p{N}])[a-z]{2}\d{2}(?:\s?[a-z0-9]){10,30}(?![\p{L}\p{N}])/giu;

const OFF_PLATFORM_PHRASES = [
  'przelew', 'przelewem', 'na konto', 'numer konta', 'na numer konta', 'na karte', 'blik', 'paypal', 'revolut',
  'western union', 'poza olx', 'bank transfer', 'wire transfer', 'outside olx',
  'на карту', 'на картку', 'на счет', 'на рахунок', 'перевод', 'переказ', 'поза olx', 'вне olx',
].map((phrase) => {
  const escaped = fold(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
});

function formatPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ',');
}

export function fillPrice(
  reply: string,
  proposed: number | null,
  floor: number,
  selling: number,
): { text: string; price: number | null } {
  if (proposed === null) return { text: reply, price: null };
  const price = Math.min(selling, Math.max(proposed, floor));
  return { text: reply.split(PRICE_PLACEHOLDER).join(formatPrice(price)), price };
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function priceNumbers(text: string, currency: string): number[] {
  const lowered = text.toLowerCase();
  const codes = [...BASE_CURRENCIES, currency.toLowerCase()].filter(Boolean).map(escapeRegex).join('|');
  const found: number[] = [];
  const after = new RegExp(`(${NUMBER})\\s*(?:${codes})(?![\\p{L}\\p{N}])`, 'gu');
  const before = new RegExp(`(?<![\\p{L}\\p{N}])(?:${codes})\\s*(${NUMBER})`, 'gu');
  for (const m of lowered.matchAll(after)) found.push(toNumber(m[1]));
  for (const m of lowered.matchAll(before)) found.push(toNumber(m[1]));
  const tokens = lowered.split(/\s+/);
  tokens.forEach((token, i) => {
    if (!PRICE_WORDS.some((w) => token.replace(/[^\p{L}]/gu, '') === w)) return;
    for (const next of tokens.slice(i + 1, i + 1 + PRICE_WORD_WINDOW)) {
      const m = new RegExp(`^(${NUMBER})`, 'u').exec(next);
      if (m) {
        found.push(toNumber(m[1]));
        break;
      }
    }
  });
  return found;
}

function hasPhone(text: string): boolean {
  if (hasCardNumber(text)) return false;
  const withoutIban = text.replace(IBAN, ' ');
  for (const run of withoutIban.matchAll(PHONE_RUN)) {
    if (run[0].replace(/\D/g, '').length >= PHONE_MIN_DIGITS) return true;
  }
  return false;
}

function hasContact(text: string): boolean {
  return hasPhone(text) || EMAIL.test(text) || ADDRESS.test(text);
}

function hasIban(text: string): boolean {
  IBAN.lastIndex = 0;
  return IBAN.test(text) || hasCardNumber(text);
}

function hasOffPlatformPayment(text: string): boolean {
  const views = [fold(text, ' '), joinObfuscated(fold(text, ''))];
  return views.some((plain) =>
    [plain, latinFold(plain)].some((view) => OFF_PLATFORM_PHRASES.some((re) => re.test(view))),
  );
}

export function validateDraft(
  text: string,
  ctx: { floor: number; currency: string; filledPrice: number | null },
): { ok: true } | { ok: false; rule: DraftRule } {
  const clean = stripZeroWidth(text);
  const fail = (rule: DraftRule) => ({ ok: false as const, rule });
  if (clean.trim() === '') return fail('empty');
  if (clean.includes(PRICE_PLACEHOLDER)) return fail('unfilled_placeholder');
  if (clean.length > MAX_REPLY_LENGTH) return fail('too_long');
  if (hasForeignLink(clean, false)) return fail('link');
  if (hasContact(clean)) return fail('contact');
  if (hasIban(clean)) return fail('iban');
  if (hasOffPlatformPayment(clean)) return fail('off_platform_payment');
  if (ctx.filledPrice !== null && ctx.filledPrice < ctx.floor) return fail('below_floor');
  if (priceNumbers(clean, ctx.currency).some((n) => n < ctx.floor)) return fail('below_floor');
  return { ok: true };
}
