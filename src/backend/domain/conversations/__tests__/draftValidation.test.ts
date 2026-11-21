import { fillPrice, validateDraft, MAX_REPLY_LENGTH, PRICE_PLACEHOLDER } from '../draftValidation';

const ctx: { floor: number; currency: string; filledPrice: number | null } = {
  floor: 70,
  currency: 'PLN',
  filledPrice: null,
};
const rule = (text: string, c = ctx) => {
  const r = validateDraft(text, c);
  return r.ok ? 'ok' : r.rule;
};

describe('fillPrice', () => {
  const reply = `Dam za ${PRICE_PLACEHOLDER} zł.`;
  it('clampsProposedPriceUpToFloor', () => {
    expect(fillPrice(reply, 40, 70, 100)).toEqual({ text: 'Dam za 70 zł.', price: 70 });
  });
  it('keepsProposedAboveFloor', () => {
    expect(fillPrice(reply, 85, 70, 100).text).toBe('Dam za 85 zł.');
  });
  it('neverExceedsSellingPrice', () => {
    expect(fillPrice(reply, 150, 70, 100)).toEqual({ text: 'Dam za 100 zł.', price: 100 });
  });
  it('formatsFractionsWithComma', () => {
    expect(fillPrice(reply, 70.5, 70, 100).text).toBe('Dam za 70,50 zł.');
  });
  it('leavesTextWhenNoProposal', () => {
    expect(fillPrice('Dzień dobry', null, 70, 100)).toEqual({ text: 'Dzień dobry', price: null });
  });
});

describe('validateDraft', () => {
  it('acceptsPlainReply', () => {
    expect(rule('Dzień dobry, produkt jest dostępny. Cena 80 zł.')).toBe('ok');
  });
  it('rejectsCurrencyNumberBelowFloor', () => {
    expect(rule('Mogę dać za 50 zł')).toBe('below_floor');
    expect(rule('Cena 50 pln')).toBe('below_floor');
    expect(rule('cena: 50')).toBe('below_floor');
  });
  it('rejectsFilledPriceBelowFloor', () => {
    expect(rule('Dobrze', { ...ctx, filledPrice: 60 })).toBe('below_floor');
  });
  it('ignoresNumbersWithoutCurrency', () => {
    expect(rule('iPhone 12, 2 szt.', { ...ctx, floor: 15 })).toBe('ok');
  });
  it('rejectsLink', () => {
    expect(rule('Zobacz https://example.com/x')).toBe('link');
    expect(rule('Zobacz https://www.olx.pl/d/oferta/1')).toBe('link');
    expect(rule('Zobacz example[.]com')).toBe('link');
  });
  it('rejectsPhone', () => {
    expect(rule('Zadzwoń +48 600 100 200')).toBe('contact');
    expect(rule('Телефон 050-123-45-67 8')).toBe('contact');
  });
  it('rejectsEmail', () => {
    expect(rule('Pisz na jan.kowalski@example.com')).toBe('contact');
  });
  it('rejectsStreetAddress', () => {
    expect(rule('Odbiór: ul. Długa 5')).toBe('contact');
    expect(rule('Адрес: вул. Шевченка 3')).toBe('contact');
  });
  it('rejectsIban', () => {
    expect(rule('Konto PL61 1090 1014 0000 0712 1981 2874')).toBe('iban');
    expect(rule('Karta 4111 1111 1111 1111')).toBe('iban');
  });
  it('rejectsOffPlatformPayment', () => {
    expect(rule('Proszę o przelew na konto')).toBe('off_platform_payment');
    expect(rule('оплата на карту')).toBe('off_platform_payment');
  });
  it('rejectsLeftoverPlaceholder', () => {
    expect(rule(`Cena ${PRICE_PLACEHOLDER}`)).toBe('unfilled_placeholder');
  });
  it('rejectsTooLong', () => {
    expect(rule('a'.repeat(MAX_REPLY_LENGTH + 1))).toBe('too_long');
  });
  it('rejectsEmpty', () => {
    expect(rule('  ')).toBe('empty');
  });

  // Fix round 1 regression guards
  it('parsesThousandsSeparators', () => {
    expect(rule('Cena 1 000 zł')).toBe('ok');
    expect(rule('Cena 1.000 zł')).toBe('ok');
    expect(rule('Cena 1 000,50 zł')).toBe('ok');
    expect(rule(`Cena 1${String.fromCharCode(0xA0)}000 zł`)).toBe('ok');
    expect(rule(`Cena 1${String.fromCharCode(0x202F)}000 zł`)).toBe('ok');
    expect(rule('Cena 1 000')).toBe('ok');
  });
  it('recognisesCurrencyWords', () => {
    expect(rule('Dam za 50 złotych')).toBe('below_floor');
    expect(rule('Dam za 50 zlotych')).toBe('below_floor');
    expect(rule('Dam za 50 euro')).toBe('below_floor');
    expect(rule('Dam 60 $')).toBe('below_floor');
    expect(rule('Дам 50 гривень')).toBe('below_floor');
    expect(rule('Дам 50 руб')).toBe('below_floor');
  });
  it('skipsDeliveryAmounts', () => {
    expect(rule('Dostawa 15 zł')).toBe('ok');
    expect(rule('dostawa 15 zł, produkt 80 zł')).toBe('ok');
    expect(rule('dostawa 15 zł, produkt 50 zł')).toBe('below_floor');
    expect(rule('dostawa 15 zł, cena 50 zł')).toBe('below_floor');
  });
  it('checksBothEndsOfRanges', () => {
    expect(rule('od 50 do 90 zł')).toBe('below_floor');
    expect(rule('50-60 zł')).toBe('below_floor');
    expect(rule('od 80 do 90 zł')).toBe('ok');
  });
  it('treatsNonFiniteProposalAsNull', () => {
    expect(fillPrice(`Za ${PRICE_PLACEHOLDER}`, Number.NaN, 70, 100)).toEqual({ text: `Za ${PRICE_PLACEHOLDER}`, price: null });
    expect(fillPrice(`Za ${PRICE_PLACEHOLDER}`, Number.POSITIVE_INFINITY, 70, 100).price).toBeNull();
  });
  it('allowsInPersonPaymentWording', () => {
    expect(rule('BLIK przy odbiorze')).toBe('ok');
    expect(rule('Płatność przy odbiorze')).toBe('ok');
    expect(rule('Zapłacisz przelewem OLX')).toBe('ok');
    expect(rule('Gotówka osobiście lub blik przy spotkaniu in person')).toBe('ok');
    expect(rule('przelew na konto 1234')).toBe('off_platform_payment');
    expect(rule('Wyślij kod blik')).toBe('off_platform_payment');
    expect(rule('Zapłać przez link')).toBe('off_platform_payment');
    expect(rule('переказ на карту')).toBe('off_platform_payment');
  });

  it('doesNotLetDeliveryWordsMaskLowPrice', () => {
    for (const text of [
      'Dostawa 15 zł',
      'dostawa: 15 zł',
      'Wysyłka kurierem 15 zł',
      'Dostawa kurierem InPost 15 zł',
      'dostawa 15 zł, produkt 80 zł',
      'wysyłka: 50 zł',
    ]) {
      expect(rule(text)).toBe('ok');
    }
    for (const text of [
      'wysyłka gratis, 50 zł',
      'dostawa gratis, 50 zł',
      'dostawa gratis 50 zł',
      'dostawa, 50 zł',
      'dostawa gratis. Dam 50 zł',
      'Wysyłka możliwa, ale dam 50 zł',
      'dostawa i cena razem 50 zł',
      'cena z dostawą 50 zł',
    ]) {
      expect(rule(text)).toBe('below_floor');
    }
  });
});
