import type { ScreeningReason } from './types';

export const SCREENING_RULES_VERSION = 'screening@1';

/** Hosts (and their subdomains) that count as official OLX. */
export const OFFICIAL_OLX_DOMAINS: readonly string[] = ['olx.pl', 'olx.ua'];

/** TLDs recognised for bare domains (no scheme, no www). Prefixed URLs accept any TLD. */
export const BARE_DOMAIN_TLDS: readonly string[] = [
  'com', 'net', 'org', 'pl', 'ua', 'ru', 'by', 'kz', 'su', 'info', 'biz', 'xyz', 'top',
  'site', 'online', 'shop', 'store', 'click', 'link', 'cc', 'co', 'me', 'io', 'eu', 'de',
  'uk', 'ly', 'to', 'tk', 'ml', 'ga', 'cf', 'gq', 'app', 'live', 'club', 'vip', 'icu', 'cn',
  'ws', 'pw', 'work', 'website', 'space', 'fun', 'рф', 'укр', 'бел', 'онлайн', 'сайт',
];

/** Cyrillic letters that look like Latin ones; folded to Latin for Latin phrases, hosts and hashing. */
export const CYRILLIC_CONFUSABLES: Readonly<Record<string, string>> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
  'ѕ': 's', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
};

/** Spelled-out dot words, replaced with "." when they sit between two word characters. */
export const DOT_WORDS: readonly string[] = ['dot', 'dоt', 'kropka', 'точка', 'крапка'];

/**
 * Phrase lists. Matched against text that is lowercased, diacritic-folded and whitespace-collapsed;
 * phrases are folded the same way at load time, so write them naturally.
 */
export const PHRASES: Readonly<Record<Exclude<ScreeningReason, 'foreign_link' | 'repeated_text' | 'message_flood'>, readonly string[]>> = {
  payment_data_request: [
    // PL
    'kod blik', 'kodu blik', 'blik kod', 'kod sms', 'kod z sms', 'kod autoryzacyjny', 'kod weryfikacyjny',
    'cvv', 'cvc', 'login do banku', 'dane logowania do banku', 'dane do logowania', 'numer karty', 'dane karty',
    'dane do przelewu karta',
    // UK
    'код blik', 'код з смс', 'код з sms', 'код підтвердження', 'смс код', 'cvv код', 'логін до банку',
    'дані картки', 'номер картки', 'дані карти', 'номер карти',
    // RU
    'код из смс', 'код из sms', 'код подтверждения', 'логин от банка', 'логин банка', 'данные карты',
    'номер карты', 'пароль от банка',
    // EN
    'blik code', 'sms code', 'verification code', 'bank login', 'online banking login', 'card number',
    'card details', 'security code', 'one-time code', 'otp code',
  ],
  messenger_move: [
    'telegram', 'telegramie', 'telegrama', 'tg', 'тг', 'signal', 'телеграм', 'телеграме', 'телеграмі', 'телеграмм', 'whatsapp', 'whats app', 'watsapp', 'ватсап', 'вотсап', 'вацап',
    'viber', 'вайбер', 'вибер', 'wa.me', 't.me', 'messenger', 'месенджер', 'мессенджер',
  ],
  fake_payment_confirmation: [
    // PL
    'juz zaplacilem', 'juz zaplacilam', 'zaplacilem', 'zaplacilam', 'dokonalem platnosci', 'dokonalam platnosci',
    'wplacilem', 'wplacilam', 'platnosc zostala dokonana', 'platnosc wyslana', 'pieniadze wyslane',
    // UK
    'я вже оплатив', 'я вже оплатила', 'я вже сплатив', 'я вже сплатила', 'оплатив', 'оплатила', 'сплатив',
    'сплатила', 'оплата здійснена', 'гроші відправлені', 'кошти надіслано',
    // RU
    'я уже оплатил', 'я уже оплатила', 'уже оплатил', 'оплатил', 'оплата прошла', 'оплата произведена',
    'деньги отправлены', 'деньги отправил',
    // EN
    'i have paid', 'i already paid', 'i paid', 'payment sent', 'payment confirmed', 'payment completed',
    'payment has been made', 'money sent',
  ],
  prompt_injection: [
    'ignore previous instructions', 'ignore all previous', 'ignore the above', 'ignore your instructions',
    'disregard previous', 'disregard all previous', 'disregard your instructions', 'forget your instructions',
    'forget previous instructions', 'forget all previous', 'override your instructions', 'new instructions',
    'you are now a', 'system prompt', 'developer mode', 'jailbreak', 'act as the seller', 'reveal your prompt',
    'zignoruj poprzednie', 'ignoruj poprzednie', 'zignoruj wszystkie instrukcje', 'ignoruj instrukcje',
    'zapomnij o instrukcjach', 'zapomnij poprzednie instrukcje', 'nowe instrukcje', 'od teraz jestes',
    'ігноруй попередні', 'ігноруйте попередні', 'забудь інструкції', 'нові інструкції', 'тепер ти',
    'игнорируй предыдущие', 'игнорируйте предыдущие', 'забудь инструкции', 'новые инструкции', 'теперь ты',
  ],
};

/** Role-tag shapes that try to impersonate a chat transcript. Tested on lowercased text. */
export const ROLE_TAG_PATTERNS: readonly RegExp[] = [
  /<\/?\s*(?:system|assistant|user|developer|tool|instructions?)\b[^>]*>/,
  /^\s*#{1,6}\s*(?:system|assistant|user|developer)\s*:/m,
  /^\s*(?:system|assistant|developer)\s*:/m,
  /\[\/?(?:system|assistant|inst)\]/,
  /<\|[^|>]{1,40}\|>/,
];

/** A run of this many base64 characters without spaces counts as an encoded blob. */
export const BASE64_BLOB_MIN_RUN = 80;
