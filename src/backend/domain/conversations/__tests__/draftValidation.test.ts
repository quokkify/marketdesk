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
});
