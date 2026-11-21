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
const BASE_CURRENCIES = [
  'złotych', 'złote', 'złoty', 'zlotych', 'zlote', 'zloty', 'zł', 'zl', 'pln', 'euro', 'eur', '€', '$', 'usd',
  'гривень', 'гривні', 'гривня', 'грн', 'uah', 'рублей', 'руб',
];
const PRICE_WORDS = ['cena', 'ціна', 'цена', 'price'];
const DELIVERY_WORDS = [
  'dostawa', 'dostawy', 'wysylka', 'wysyłka', 'przesylka', 'przesyłka', 'kurier', 'paczkomat', 'inpost',
  'доставка', 'відправка', 'delivery', 'shipping',
];
const DELIVERY_FILLER_WINDOW = 2;
const DELIVERY_FILLERS = new Set([
  'kurierem', 'kurier', 'inpost', 'paczkomat', 'paczkomatem', 'dpd', 'dhl', 'poczta', 'pocztą', 'koszt',
  'kosztuje', 'to', 'wynosi', 'ok', 'około', 'okolo',
]);
const CLAUSE_PUNCT = /[.,;!?—]/;
const PRICE_WORD_WINDOW = 3;
const SEP = '[\\u00a0\\u202f .]';
const NUMBER = `\\d{1,3}(?:${SEP}\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
const RANGE_JOINER = '(?:-|–|—|do|до|to)';
const PHONE_RUN = /\+?\d(?:[ -]?\d)+/g;
const EMAIL = /[^\s@]+@[^\s@]+\.\p{L}{2,}/u;
const ADDRESS = /(?<![\p{L}])(?:(?:ul|вул|ул)\.|ulica\s)\s*\p{L}/iu;
const IBAN = /(?<![\p{L}\p{N}])[a-z]{2}\d{2}(?:\s?[a-z0-9]){10,30}(?![\p{L}\p{N}])/giu;
const PRICE_WORD_NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${PRICE_WORDS.join('|')})(?![\\p{L}\\p{N}])((?:[^\\p{L}\\p{N}]*\\p{L}+){0,${PRICE_WORD_WINDOW - 1}}[^\\p{L}\\p{N}]*)(${NUMBER})`,
  'gu',
);
const DELIVERY_WORD_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${DELIVERY_WORDS.join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);
const IN_PERSON_MARKERS = [
  'przy odbiorze', 'osobiscie', 'odbior osobisty', 'при отриманні', 'при встрече', 'in person',
];
const OFF_PLATFORM_PHRASES = [
  'przelew na konto', 'przelewem na konto', 'numer konta', 'na numer konta', 'na karte', 'на карту', 'на картку',
  'переказ на карту', 'переказ на картку', 'перевод на карту', 'bank transfer', 'wire transfer', 'western union',
  'iban', 'zaplac przez link', 'zaplac linkiem', 'pay via link', 'poza olx', 'поза olx', 'вне olx', 'outside olx',
];
const BLIK = 'blik';

function phraseRegex(phrase: string): RegExp {
  const escaped = fold(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}

const OFF_PLATFORM_REGEXES = OFF_PLATFORM_PHRASES.map(phraseRegex);
const IN_PERSON_REGEXES = IN_PERSON_MARKERS.map(phraseRegex);
const BLIK_REGEX = phraseRegex(BLIK);

interface PriceRegexes {
  after: RegExp;
  before: RegExp;
}
const priceRegexCache = new Map<string, PriceRegexes>();

function priceRegexes(currency: string): PriceRegexes {
  const key = currency.toLowerCase();
  let cached = priceRegexCache.get(key);
  if (!cached) {
    const codes = [...BASE_CURRENCIES, key]
      .filter(Boolean)
      .sort((x, y) => y.length - x.length)
      .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    cached = {
      after: new RegExp(
        `(?:(${NUMBER})\\s*${RANGE_JOINER}\\s*)?(${NUMBER})\\s*(?:${codes})(?![\\p{L}\\p{N}])`,
        'gu',
      ),
      before: new RegExp(`(?<![\\p{L}\\p{N}])(?:${codes})\\s*(${NUMBER})`, 'gu'),
    };
    priceRegexCache.set(key, cached);
  }
  return cached;
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ',');
}

export function fillPrice(
  reply: string,
  proposed: number | null,
  floor: number,
  selling: number,
): { text: string; price: number | null } {
  if (proposed === null || !Number.isFinite(proposed)) return { text: reply, price: null };
  const price = Math.min(selling, Math.max(proposed, floor));
  return { text: reply.split(PRICE_PLACEHOLDER).join(formatPrice(price)), price };
}

function toNumber(raw: string): number {
  const decimal = /[.,]\d{1,2}$/.exec(raw);
  const integerPart = decimal ? raw.slice(0, decimal.index) : raw;
  const fraction = decimal ? decimal[0].slice(1) : '';
  return Number(`${integerPart.replace(/[   .]/g, '')}${fraction ? `.${fraction}` : ''}`);
}

function isDeliveryAmount(before: string): boolean {
  let last: RegExpMatchArray | undefined;
  for (const m of before.matchAll(DELIVERY_WORD_REGEX)) last = m;
  if (!last) return false;
  const between = before
    .slice((last.index ?? 0) + last[0].length)
    .replace(/(?<![\p{L}\p{N}])ok\./gu, 'ok')
    .replace(/[:~]/g, ' ');
  if (CLAUSE_PUNCT.test(between)) return false;
  const tokens = between.split(/\s+/).filter(Boolean);
  return tokens.length <= DELIVERY_FILLER_WINDOW && tokens.every((t) => DELIVERY_FILLERS.has(t));
}

function priceNumbers(text: string, currency: string): number[] {
  const lowered = text.toLowerCase();
  const { after, before } = priceRegexes(currency);
  const found: number[] = [];
  const add = (index: number, ...raws: (string | undefined)[]) => {
    if (isDeliveryAmount(lowered.slice(0, index))) return;
    for (const raw of raws) if (raw) found.push(toNumber(raw));
  };
  for (const m of lowered.matchAll(after)) add(m.index, m[1], m[2]);
  for (const m of lowered.matchAll(before)) add(m.index, m[1]);
  for (const m of lowered.matchAll(PRICE_WORD_NUMBER)) found.push(toNumber(m[2]));
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
  const views = [fold(text, ' '), joinObfuscated(fold(text, ''))].flatMap((plain) => [plain, latinFold(plain)]);
  const matches = (res: RegExp[]) => views.some((view) => res.some((re) => re.test(view)));
  if (matches(OFF_PLATFORM_REGEXES)) return true;
  return matches([BLIK_REGEX]) && !matches(IN_PERSON_REGEXES);
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
