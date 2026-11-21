// Keyword intent detection and fixed polite templates, used when Hermes is not consulted.
// Templates contain no numbers or links; a haggle reply carries {{PRICE}} and no proposed price,
// so the graph offers the selling price.

import type { BuyerIntent } from '../../domain/conversations/types';
import type { IReplyDraftAI, ReplyContext } from '../../domain/ports/IReplyDraftAI';
import { PRICE_PLACEHOLDER } from '../../domain/conversations/draftValidation';

type Language = 'pl' | 'uk' | 'ru' | 'en';

const KEYWORDS: Array<[BuyerIntent, RegExp]> = [
  ['availability', /dostępn|available|є в наявності|в наявності|в наличии/i],
  ['haggle', /cena|taniej|zniżk|rabat|знижк|скидк|дешевше|дешевле|price|discount|cheaper/i],
  ['logistics', /wysyłk|dostaw|odbiór|доставк|відправ|отправ|самовивіз|самовывоз|shipping|delivery|pickup/i],
];

const TEMPLATES: Record<BuyerIntent, Record<Language, string>> = {
  availability: {
    pl: 'Dzień dobry! Tak, ogłoszenie jest nadal aktualne. Zapraszam do kontaktu.',
    uk: 'Доброго дня! Так, товар ще в наявності. Пишіть, якщо є запитання.',
    ru: 'Добрый день! Да, товар ещё в наличии. Пишите, если есть вопросы.',
    en: 'Hello! Yes, the item is still available. Feel free to ask if you have any questions.',
  },
  haggle: {
    pl: `Dzień dobry! Mogę zaproponować cenę ${PRICE_PLACEHOLDER}.`,
    uk: `Доброго дня! Можу запропонувати ціну ${PRICE_PLACEHOLDER}.`,
    ru: `Добрый день! Могу предложить цену ${PRICE_PLACEHOLDER}.`,
    en: `Hello! I can offer the price of ${PRICE_PLACEHOLDER}.`,
  },
  logistics: {
    pl: 'Dzień dobry! Wysyłka i odbiór osobisty są możliwe przez OLX. Proszę dać znać, co Pani/Panu odpowiada.',
    uk: 'Доброго дня! Доставка та самовивіз можливі через OLX. Напишіть, що вам зручніше.',
    ru: 'Добрый день! Доставка и самовывоз возможны через OLX. Напишите, что вам удобнее.',
    en: 'Hello! Shipping and pickup are possible through OLX. Please let me know which suits you.',
  },
  other: {
    pl: 'Dzień dobry! Dziękuję za wiadomość. Odpowiem najszybciej, jak to możliwe.',
    uk: 'Доброго дня! Дякую за повідомлення. Відповім якнайшвидше.',
    ru: 'Добрый день! Спасибо за сообщение. Отвечу как можно скорее.',
    en: 'Hello! Thank you for your message. I will get back to you as soon as possible.',
  },
};

const POLISH_HINT = /[ąćęłńóśźż]|dzień|dzien|dostępn|cena|taniej|wysyłk|odbiór|zniżk|rabat/i;

export function lastBuyerText(ctx: ReplyContext): string {
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    if (ctx.messages[i].direction === 'buyer') return ctx.messages[i].text;
  }
  return '';
}

export function detectLanguage(text: string): Language {
  if (/[Ѐ-ӿ]/.test(text)) return /[іїєґІЇЄҐ]/.test(text) ? 'uk' : 'ru';
  return POLISH_HINT.test(text) ? 'pl' : 'en';
}

export function detectIntent(text: string): BuyerIntent {
  return KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

export class OfflineReplyDraftAI implements IReplyDraftAI {
  source(): 'offline' {
    return 'offline';
  }

  async classify(ctx: ReplyContext): Promise<{ intent: BuyerIntent; confidence: 'high' | 'medium' | 'low' }> {
    const intent = detectIntent(lastBuyerText(ctx));
    return { intent, confidence: intent === 'other' ? 'low' : 'medium' };
  }

  async draft(
    ctx: ReplyContext,
    intent: BuyerIntent,
  ): Promise<{ reply: string; counterOffer: boolean; proposedPrice: number | null }> {
    const reply = TEMPLATES[intent][detectLanguage(lastBuyerText(ctx))];
    return { reply, counterOffer: false, proposedPrice: null };
  }
}
