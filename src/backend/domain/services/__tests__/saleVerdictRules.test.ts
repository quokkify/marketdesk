import {
  checkFailed,
  combineVerdict,
  infoCheckFromRecheck,
  photosCheck,
  priceCheckFromEstimate,
} from '../saleVerdictRules';
import type { PriceEstimate, ProductRecheckItem, StoredPriceEstimate } from '../../../../shared/types';

const T0 = new Date('2026-11-22T10:00:00.000Z');
const T1 = new Date('2026-11-22T11:00:00.000Z');

const estimate: PriceEstimate = {
  startPrice: 279,
  floorPrice: 250,
  retailAnchor: null,
  usedRange: null,
  reasoning: 'r',
  confidence: 'medium',
};

const stored = (hiddenReason: StoredPriceEstimate['hiddenReason'] = null): StoredPriceEstimate => ({
  estimate,
  estimatedAt: T0.toISOString(),
  hiddenReason,
  researchNote: null,
  researchUpdatedAt: '2026-11-22T09:00:00.000Z',
});

describe('photosCheck', () => {
  it('asks to add photos when there are none', () => {
    const check = photosCheck(0, T0);
    expect(check.status).toBe('fix');
    expect(check.reasons.map((r) => r.code)).toEqual(['photos_missing']);
    expect(check.reasons[0].field).toBe('images');
    expect(check.refs.photoCount).toBe(0);
  });

  it('is ready with photos', () => {
    const check = photosCheck(3, T0);
    expect(check.status).toBe('ready');
    expect(check.reasons).toEqual([]);
    expect(check.checkedAt).toBe(T0.toISOString());
    expect(check.refs.photoCount).toBe(3);
  });
});

describe('priceCheckFromEstimate', () => {
  const estimated = (
    currentPrice: number,
    s: StoredPriceEstimate | null,
    suggestionType: 'suggested_lower_price' | 'suggested_higher_price' | 'price_estimate_unavailable' | null = null,
  ) => priceCheckFromEstimate({ kind: 'estimated', currentPrice, stored: s, suggestionType, eventIds: ['e1'] }, T0);

  it('needs a human when the estimate is unavailable', () => {
    expect(estimated(279, stored(), 'price_estimate_unavailable').reasons[0].code).toBe('estimate_unavailable');
    const noStored = estimated(279, null);
    expect(noStored.status).toBe('needs_human');
    expect(noStored.reasons[0].code).toBe('estimate_unavailable');
  });

  it('needs a human when research is weak', () => {
    const check = estimated(279, stored('low_confidence'));
    expect(check.status).toBe('needs_human');
    expect(check.reasons[0].code).toBe('weak_research');
  });

  it('asks to lower a price above the ceiling', () => {
    const check = estimated(349, stored(), 'suggested_lower_price');
    expect(check.status).toBe('fix');
    expect(check.reasons[0].code).toBe('above_ceiling');
    expect(check.reasons[0].message).toContain('279');
    expect(check.reasons[0].field).toBe('sellingPrice');
    expect(check.refs.eventIds).toEqual(['e1']);
    expect(check.refs.researchUpdatedAt).toBe('2026-11-22T09:00:00.000Z');
    expect(check.refs).toMatchObject({ currentPrice: 349, proposedPrice: 279, currency: 'PLN' });
  });

  it('asks to raise a price below the floor', () => {
    const check = estimated(240, stored());
    expect(check.status).toBe('fix');
    expect(check.reasons[0].code).toBe('below_floor');
    expect(check.refs).toMatchObject({ currentPrice: 240, proposedPrice: null });
  });

  it('is ready within the band', () => {
    for (const hidden of ['within_threshold', 'floor_cancels'] as const) {
      const check = estimated(279, stored(hidden));
      expect(check.status).toBe('ready');
      expect(check.reasons[0].code).toBe('fair_price');
    }
  });

  it('is ready when a higher-price suggestion is still inside the band', () => {
    expect(estimated(260, stored(), 'suggested_higher_price').status).toBe('ready');
  });

  it('does not flag a price above the ceiling without a lower-price suggestion', () => {
    expect(estimated(349, stored('within_threshold')).status).toBe('ready');
  });

  it('maps the non-estimate kinds', () => {
    for (const kind of ['no_listing', 'not_pln', 'not_configured'] as const) {
      expect(priceCheckFromEstimate({ kind }, T0).status).toBe('needs_human');
    }
    const failed = priceCheckFromEstimate({ kind: 'failed' }, T0);
    expect(failed.status).toBe('needs_human');
    expect(failed.reasons[0].code).toBe('check_failed');
    expect(priceCheckFromEstimate({ kind: 'research_running' }, T0).status).toBe('pending');
  });
});

describe('infoCheckFromRecheck', () => {
  it('keeps only fix and review items of info keys', () => {
    const items: ProductRecheckItem[] = [
      { key: 'description', status: 'fix', message: 'Add a description', editField: 'description' },
      { key: 'title', status: 'ready', message: 'ok' },
      { key: 'price', status: 'fix', message: 'price problem' },
    ];
    const check = infoCheckFromRecheck(items, T0);
    expect(check.status).toBe('fix');
    expect(check.reasons).toEqual([
      { code: 'info_description', message: 'Add a description', field: 'description' },
    ]);
  });

  it('maps review to needs_human and prefers it over fix', () => {
    const check = infoCheckFromRecheck(
      [
        { key: 'category', status: 'review', message: 'Confirm category', editField: 'category' },
        { key: 'title', status: 'fix', message: 'Shorten title', editField: 'name' },
      ],
      T0,
    );
    expect(check.status).toBe('needs_human');
    expect(check.reasons).toHaveLength(2);
  });

  it('is ready when nothing needs attention', () => {
    expect(infoCheckFromRecheck([{ key: 'title', status: 'ready', message: 'ok' }], T0).status).toBe('ready');
  });
});

describe('checkFailed', () => {
  it('needs a human with check_failed', () => {
    const check = checkFailed('price', T0);
    expect(check.check).toBe('price');
    expect(check.status).toBe('needs_human');
    expect(check.reasons[0].code).toBe('check_failed');
  });
});

describe('combineVerdict', () => {
  it('keeps previous checks the fresh run did not cover', () => {
    const info = { ...photosCheck(3, T0), check: 'info' as const };
    const { checks, overall } = combineVerdict([priceCheckFromEstimate({ kind: 'no_listing' }, T1), photosCheck(0, T1)], {
      info,
    });
    expect(checks.info?.checkedAt).toBe(T0.toISOString());
    expect(overall).toBe('needs_human');

    const fix = combineVerdict([photosCheck(0, T1)], { info });
    expect(fix.overall).toBe('fix');
    expect(fix.checks.info).toBe(info);
    expect(fix.checks.photos?.checkedAt).toBe(T1.toISOString());
  });

  it('replaces a previous check with the fresh one', () => {
    const { checks, overall } = combineVerdict([photosCheck(2, T1)], { photos: photosCheck(0, T0) });
    expect(checks.photos?.status).toBe('ready');
    expect(overall).toBe('ready');
  });

  it('needs a human when a fresh check failed', () => {
    expect(combineVerdict([checkFailed('info', T1)], { photos: photosCheck(3, T0) }).overall).toBe('needs_human');
  });

  it('needs a human when every check is pending', () => {
    const pending = priceCheckFromEstimate({ kind: 'research_running' }, T1);
    expect(combineVerdict([pending], {}).overall).toBe('needs_human');
  });

  it('ignores pending checks when others are ready', () => {
    const pending = priceCheckFromEstimate({ kind: 'research_running' }, T1);
    expect(combineVerdict([pending, photosCheck(1, T1)], {}).overall).toBe('ready');
  });
});
