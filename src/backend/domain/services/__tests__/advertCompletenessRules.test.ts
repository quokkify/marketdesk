import {
  ADVERT_DRIFTED,
  CATEGORY_OUT_OF_SYNC,
  attributeIdempotencyKey,
  attributesCheck,
  blockedCheck,
  categoryCheck,
  containsWholeWord,
  deliveryCheck,
  fillableAttributes,
  packagesForSize,
  verifiableValues,
  type OlxCategoryAttribute,
} from '../advertCompletenessRules';

const NOW = new Date('2026-11-27T10:00:00.000Z');

function attr(over: Partial<OlxCategoryAttribute> & { code: string }): OlxCategoryAttribute {
  return { label: over.code, required: false, multiple: false, values: [{ code: 'a', label: 'A' }], ...over };
}

const BRAND = attr({
  code: 'brand',
  label: 'Brand',
  values: [
    { code: 'apple', label: 'Apple' },
    { code: 'samsung', label: 'Samsung' },
  ],
});

describe('containsWholeWord', () => {
  it('matches a label as a whole word only', () => {
    expect(containsWholeWord('Projektor LED', 'LED')).toBe(true);
    expect(containsWholeWord('SOLED', 'LED')).toBe(false);
    expect(containsWholeWord('Pineapple case', 'Apple')).toBe(false);
  });

  it('ignores diacritics and case', () => {
    expect(containsWholeWord('Do 5000 obrotów', 'obrotow')).toBe(true);
  });
});

describe('fillableAttributes', () => {
  it('skips set codes, delivery, multiple and attributes without values', () => {
    const category = [
      BRAND,
      attr({ code: 'state' }),
      attr({ code: 'delivery' }),
      attr({ code: 'tags', multiple: true }),
      attr({ code: 'color', values: [] }),
    ];
    const result = fillableAttributes(category, [{ code: 'state', value: 'new' }]);
    expect(result.map((a) => a.code)).toEqual(['brand']);
  });
});

describe('verifiableValues', () => {
  it('picks the one value whose label is in the text', () => {
    const text = { name: 'Apple AirPods 4 MXP63ZM/A, etui USB-C', description: '' };
    expect(verifiableValues([BRAND], text)).toEqual([{ code: 'brand', value: 'apple' }]);
  });

  it('returns nothing for a substring of another word', () => {
    expect(verifiableValues([BRAND], { name: 'Pineapple case', description: '' })).toEqual([]);
  });

  it('returns nothing when two labels match', () => {
    expect(verifiableValues([BRAND], { name: 'Apple Samsung', description: '' })).toEqual([]);
  });

  it('matches LED but not SOLED', () => {
    const led = attr({ code: 'light', values: [{ code: 'led', label: 'LED' }] });
    expect(verifiableValues([led], { name: 'Projektor LED', description: '' })).toEqual([
      { code: 'light', value: 'led' },
    ]);
    expect(verifiableValues([led], { name: 'SOLED', description: '' })).toEqual([]);
  });

  it('matches across diacritics', () => {
    const rpm = attr({ code: 'rpm', values: [{ code: 'r5', label: 'obrotow' }] });
    expect(verifiableValues([rpm], { name: 'Pralka', description: 'do 1200 obrotów' })).toEqual([
      { code: 'rpm', value: 'r5' },
    ]);
  });
});

describe('attributesCheck', () => {
  const base = { current: [], proposalOpen: false, now: NOW, eventIds: ['e1'] };

  it('needs a human for an empty required attribute', () => {
    const check = attributesCheck({ ...base, category: [attr({ code: 'state', label: 'State', required: true })] });
    expect(check.check).toBe('attributes');
    expect(check.status).toBe('needs_human');
    expect(check.reasons[0]).toMatchObject({
      code: 'attributes_empty_required',
      message: 'Fill the required OLX field: State',
    });
    expect(check.refs.missingAttributes).toEqual(['state']);
    expect(check.refs.eventIds).toEqual(['e1']);
    expect(check.checkedAt).toBe(NOW.toISOString());
  });

  it('is ready with a note for an empty optional attribute', () => {
    const check = attributesCheck({ ...base, category: [attr({ code: 'bdo', label: 'BDO' })] });
    expect(check.status).toBe('ready');
    expect(check.reasons[0]).toMatchObject({ code: 'attributes_still_empty', message: 'Still empty on OLX: BDO' });
  });

  it('is fix while a proposal is open', () => {
    const check = attributesCheck({
      ...base,
      proposalOpen: true,
      category: [attr({ code: 'bdo', label: 'BDO' })],
    });
    expect(check.status).toBe('fix');
    expect(check.reasons[0].code).toBe('attributes_proposed');
  });

  it('is ready with no reasons when everything is filled', () => {
    const check = attributesCheck({
      ...base,
      current: [{ code: 'bdo', value: 'a' }],
      category: [attr({ code: 'bdo' })],
    });
    expect(check).toMatchObject({ status: 'ready', reasons: [] });
  });
});

describe('categoryCheck', () => {
  it('fixes a category OLX does not suggest', () => {
    const check = categoryCheck({ listingCategoryId: '5091', suggestionIds: ['1234', '5678'], now: NOW, eventIds: [] });
    expect(check.check).toBe('category');
    expect(check.status).toBe('fix');
    expect(check.reasons[0]).toMatchObject({
      code: 'category_mismatch',
      message: 'OLX suggests another category for this title',
    });
  });

  it('is ready when the category is among the suggestions', () => {
    const check = categoryCheck({ listingCategoryId: '1984', suggestionIds: ['1234', '1984'], now: NOW, eventIds: [] });
    expect(check.status).toBe('ready');
  });

  it('needs a human when OLX gave no suggestion', () => {
    const check = categoryCheck({ listingCategoryId: '1984', suggestionIds: [], now: NOW, eventIds: [] });
    expect(check.status).toBe('needs_human');
    expect(check.reasons).toEqual([
      { code: 'category_unknown', message: 'OLX gave no category suggestion for this title' },
    ]);
  });

  it('is ready on a mismatch the owner kept', () => {
    const check = categoryCheck({
      listingCategoryId: '5091', suggestionIds: ['1234'], keptByOwner: true, now: NOW, eventIds: [],
    });
    expect(check.status).toBe('ready');
    expect(check.reasons).toEqual([{ code: 'category_kept_by_owner', message: 'You kept this OLX category' }]);
  });
});

describe('blockedCheck', () => {
  it('needs a human for the given check with the given reason', () => {
    expect(blockedCheck('delivery', CATEGORY_OUT_OF_SYNC, NOW)).toMatchObject({
      check: 'delivery',
      status: 'needs_human',
      reasons: [{ code: 'category_out_of_sync', message: 'The OLX category changed since the last sync; sync the listing first' }],
    });
    expect(ADVERT_DRIFTED).toEqual({
      code: 'advert_drifted',
      message: 'The advert changed on OLX since the last sync; sync the listing first',
    });
  });
});

describe('deliveryCheck', () => {
  const base = { packageIds: [] as string[], categoryOffersDelivery: true, proposalOpen: false, now: NOW, eventIds: [] };

  it('needs a human when OLX does not offer delivery although packages are set', () => {
    const check = deliveryCheck({ ...base, mode: 'NotEligible', packageIds: ['a'] });
    expect(check.status).toBe('needs_human');
    expect(check.reasons[0].code).toBe('delivery_not_offered');
    expect(check.refs.deliveryMode).toBe('NotEligible');
  });

  it('fixes delivery that is off in a category that offers it', () => {
    const check = deliveryCheck({ ...base, mode: 'NotEligible' });
    expect(check.status).toBe('fix');
    expect(check.reasons[0]).toMatchObject({
      code: 'delivery_off',
      message: 'Buyers cannot order with Przesyłka OLX',
    });
  });

  it('fixes the category when it has no delivery', () => {
    const check = deliveryCheck({ ...base, mode: 'NotEligible', categoryOffersDelivery: false });
    expect(check.status).toBe('fix');
    expect(check.reasons[0].code).toBe('delivery_unavailable_in_category');
  });

  it.each(['', 'Unknown', 'notEligible'])('needs a human for the unknown delivery mode %p', (mode) => {
    const check = deliveryCheck({ ...base, mode });
    expect(check.status).toBe('needs_human');
    expect(check.reasons).toEqual([
      { code: 'delivery_mode_unknown', message: 'OLX reports an unknown delivery state for this advert; check it in OLX' },
    ]);
  });

  it('is ready with BuyWithDelivery', () => {
    expect(deliveryCheck({ ...base, mode: 'BuyWithDelivery', packageIds: ['a'] }).status).toBe('ready');
  });

  it('needs a human when the page could not be read', () => {
    const check = deliveryCheck({ ...base, mode: null });
    expect(check.status).toBe('needs_human');
    expect(check.reasons[0]).toMatchObject({
      code: 'probe_failed',
      message: 'Could not read the advert page on OLX',
    });
    expect(check.refs.deliveryMode).toBeNull();
  });
});

describe('packagesForSize', () => {
  const PACKAGES: Array<[string, string]> = [
    ['InPost Paczkomat® 24/7 S', 'ef5414d2-1fa4-4344-bf09-d1528cfb58e1'],
    ['InPost Paczkomat® 24/7 M', '0509518f-6d74-45bd-aba7-ce658b784b8d'],
    ['InPost Paczkomat® 24/7 L', '85076df7-ad79-4e99-a52d-c1c2d4b67b2e'],
    ['Poczta Polska S', 'e6a8e063-6531-462f-b90e-f006e0d6092d'],
    ['Poczta Polska M', '6df5439d-28fd-4f55-925f-8e1cad3532d9'],
    ['Poczta Polska L', 'a62159e6-d52b-42fc-8318-81c3fbc3926d'],
    ['Poczta Polska XL', '5bc4cd7b-07d9-4394-a0ae-ca6e63d20dd5'],
    ['InPost Kurier S', '8987b2c9-660c-4a75-bdc6-31f74704d40b'],
    ['InPost Kurier M', '62b8ebd4-3029-4d83-a0fc-f037430bda13'],
    ['InPost Kurier L', 'a6b1796d-86f1-453c-b71b-2050d376581b'],
    ['DPD Kurier S', '13b03e04-7c51-465c-bc00-adade0d01a86'],
    ['DPD Kurier M', 'b95e8f54-a715-4a95-9d4c-5f16e29131a1'],
    ['DPD Kurier L', 'ca67912d-9e3e-4294-abf8-e5dc93a40fe9'],
    ['DPD Kurier XL', '5b322e13-fe51-4e21-b710-2a456f319096'],
  ];
  const delivery = attr({
    code: 'delivery',
    multiple: true,
    values: PACKAGES.map(([label, code]) => ({ code, label })),
  });

  it('returns the S packages in catalogue order', () => {
    expect(packagesForSize(delivery, 'S')).toEqual([
      'ef5414d2-1fa4-4344-bf09-d1528cfb58e1',
      'e6a8e063-6531-462f-b90e-f006e0d6092d',
      '8987b2c9-660c-4a75-bdc6-31f74704d40b',
      '13b03e04-7c51-465c-bc00-adade0d01a86',
    ]);
  });

  it('returns the XL packages only for XL', () => {
    expect(packagesForSize(delivery, 'XL')).toEqual([
      '5bc4cd7b-07d9-4394-a0ae-ca6e63d20dd5',
      '5b322e13-fe51-4e21-b710-2a456f319096',
    ]);
  });
});

describe('attributeIdempotencyKey', () => {
  it('does not depend on the order of the values', () => {
    const a = attributeIdempotencyKey('l1', [
      { code: 'brand', value: 'apple' },
      { code: 'state', value: 'new' },
    ]);
    const b = attributeIdempotencyKey('l1', [
      { code: 'state', value: 'new' },
      { code: 'brand', value: 'apple' },
    ]);
    expect(a).toBe(b);
    expect(attributeIdempotencyKey('l2', [{ code: 'brand', value: 'apple' }])).not.toBe(a);
  });
});
