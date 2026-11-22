import type { PriceComparable, PriceEstimate, PriceResearch, ResearchRun } from '@shared/types';
import {
  discountLine,
  discountVsNew,
  estimateLines,
  usedRangeSourceNote,
  runProgressText,
  lastRunText,
  anchorsUpdatedAt,
  classLine,
} from './priceResearchModel';
import { formatDateTime } from '../../utils/formatters';

const research: PriceResearch = {
  productId: 'p-1',
  retailPrice: 469.99,
  retailCurrency: 'PLN',
  retailSource: 'MediaMarkt',
  retailCheckedAt: '2026-11-21',
  comparables: [
    { price: 200, note: 'scratched case' },
    { price: 250, note: '' },
    { price: 285, note: 'boxed' },
  ],
  specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null,
  updatedAt: '2026-11-21T10:00:00.000Z',
};

const estimate: PriceEstimate = {
  startPrice: 279,
  floorPrice: 250,
  retailAnchor: { amount: 469.99, basis: 'observed' },
  usedRange: { low: 200, high: 285, basis: 'estimated' },
  reasoning: 'Comparables cluster around 250',
  confidence: 'medium',
};

describe('priceResearchModel', () => {
  it('lists the estimate with the basis of every figure', () => {
    expect(estimateLines(estimate, 'PLN')).toEqual([
      'Start 279 zł',
      'Floor 250 zł',
      'New price 469,99 zł · observed',
      'Used range 200–285 zł · estimated',
      '−41% vs new',
      'Confidence: medium',
    ]);
  });

  it('omits the anchor and range lines when the estimate has none', () => {
    const lines = estimateLines({ ...estimate, retailAnchor: null, usedRange: null }, 'PLN');
    expect(lines).toEqual(['Start 279 zł', 'Floor 250 zł', 'Confidence: medium']);
  });

  it('computes the discount against new in whole percent', () => {
    expect(discountVsNew(279, 469.99)).toBe(-41);
    expect(discountVsNew(279, null)).toBeNull();
    expect(discountVsNew(279, 0)).toBeNull();
  });

  it('words the discount with source and date', () => {
    expect(discountLine(279, research, 'PLN')).toBe('−41% vs new · 469,99 zł (MediaMarkt, 2026-11-21)');
    expect(discountLine(279, null, 'PLN')).toBeNull();
    expect(discountLine(279, { ...research, retailPrice: null }, 'PLN')).toBeNull();
  });
});

const OLX_URL = 'https://www.olx.pl/d/oferta/airpods-4-CID99-IDabc1.html';
const OLX_URL_2 = 'https://www.olx.pl/d/oferta/airpods-4-bez-anc-CID99-IDabc2.html';

describe('comparables found on OLX', () => {
  it('sourceNoteCountsWebRows', () => {
    const withRows = (comparables: PriceResearch['comparables']): PriceResearch => ({ ...research, comparables });
    expect(usedRangeSourceNote(withRows([
      { price: 1, note: '', url: OLX_URL, source: 'web' },
      { price: 2, note: '', url: OLX_URL_2, source: 'web' },
      { price: 3, note: '' },
    ]))).toBe('2 from OLX');
    expect(usedRangeSourceNote(research)).toBeNull();
    expect(usedRangeSourceNote(null)).toBeNull();
  });

  it('appends the source note to an observed used range only', () => {
    const observed = { ...estimate, usedRange: { low: 200, high: 285, basis: 'observed' as const } };
    expect(estimateLines(observed, 'PLN', '4 from OLX')).toContain('Used range 200–285 zł · observed (4 from OLX)');
    expect(estimateLines(estimate, 'PLN', '4 from OLX')).toContain('Used range 200–285 zł · estimated');
  });
});

const NOW = new Date('2026-11-22T12:00:00.000Z');

function run(patch: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'r-1', workspaceId: 'w-1', productId: 'p-1', trigger: 'manual', status: 'running', nodes: {},
    outcome: null, failedTiers: [], errorCode: null, consecutiveFailures: 0,
    queuedAt: '2026-11-22T11:50:00.000Z', startedAt: '2026-11-22T11:50:05.000Z', finishedAt: null,
    leaseUntil: null, nextAutoAt: null, ...patch,
  };
}

describe('runProgressText', () => {
  it('is null without a run or once it finished', () => {
    expect(runProgressText(null)).toBeNull();
    expect(runProgressText(run({ status: 'finished', outcome: 'ok' }))).toBeNull();
  });

  it('says it is identifying the model while queued or before identify is done', () => {
    expect(runProgressText(run({ status: 'queued' }))).toBe('Identifying the model…');
    expect(runProgressText(run({ nodes: { identify: 'running' } }))).toBe('Identifying the model…');
  });

  it('counts the finished tier searches out of four, failures included', () => {
    expect(runProgressText(run({ nodes: { identify: 'done', sameModelUsed: 'done', lastNewPrice: 'failed' } })))
      .toBe('Searching prices: 2 of 4');
    expect(runProgressText(run({ nodes: { identify: 'done' } }))).toBe('Searching prices: 0 of 4');
  });

  it('says it is saving once all four tier searches are over', () => {
    expect(runProgressText(run({ nodes: {
      identify: 'done', sameModelUsed: 'done', lastNewPrice: 'done', substitutesNew: 'timeout', substitutesUsed: 'done',
    } }))).toBe('Saving…');
  });
});

describe('anchorsUpdatedAt', () => {
  it('is the finish time of the last run, not the attempt time nothing writes any more', () => {
    const last = run({ status: 'finished', outcome: 'ok', finishedAt: '2026-11-22T10:00:00.000Z' });
    expect(anchorsUpdatedAt(last, { ...research, lastAttemptAt: '2026-10-01T00:00:00.000Z' }))
      .toBe('2026-11-22T10:00:00.000Z');
  });

  it('falls back to the research version without a finished run', () => {
    expect(anchorsUpdatedAt(null, { ...research, lastAttemptAt: '2026-10-01T00:00:00.000Z' })).toBe(research.updatedAt);
    expect(anchorsUpdatedAt(run({}), research)).toBe(research.updatedAt);
  });

  it('is null with no run and no research', () => {
    expect(anchorsUpdatedAt(null, null)).toBeNull();
  });
});

describe('lastRunText', () => {
  const finishedAt = '2026-11-22T10:00:00.000Z';
  const nextAutoAt = '2026-11-23T10:00:00.000Z';

  it('is null without a finished run', () => {
    expect(lastRunText(null, null, NOW)).toBeNull();
    expect(lastRunText(run({}), null, NOW)).toBeNull();
  });

  it('words an ok run', () => {
    expect(lastRunText(run({ status: 'finished', outcome: 'ok', finishedAt }), nextAutoAt, NOW))
      .toBe('Prices searched 2h ago');
  });

  it('names the failed tiers and the retry time of a partial run', () => {
    const text = lastRunText(
      run({ status: 'finished', outcome: 'partial', finishedAt, failedTiers: ['substitute_used', 'last_new_price'] }),
      nextAutoAt, NOW,
    );
    expect(text).toBe(`Prices searched 2h ago; used substitutes, last new price search failed, will retry ${formatDateTime(nextAutoAt)}`);
  });

  it('gives a plain-words reason for a failed run and never the raw code', () => {
    const failed = (errorCode: string | null) =>
      lastRunText(run({ status: 'finished', outcome: 'failed', finishedAt, errorCode }), nextAutoAt, NOW);
    const retry = formatDateTime(nextAutoAt);
    expect(failed('job_lost')).toBe(`Price search failed: the search was interrupted. Will retry ${retry}`);
    expect(failed('unsafe_toolset')).toBe(`Price search failed: market search is unavailable. Will retry ${retry}`);
    expect(failed('not_configured')).toBe(`Price search failed: market search is unavailable. Will retry ${retry}`);
    expect(failed('timeout')).toBe(`Price search failed: the search took too long. Will retry ${retry}`);
    expect(failed('unusable_answer')).toBe(`Price search failed: the search returned an unusable answer. Will retry ${retry}`);
    expect(failed('no_substitutes')).toBe(`Price search failed: no comparable items were found. Will retry ${retry}`);
    expect(failed('all_tiers_failed')).toBe(`Price search failed: none of the price searches returned an answer. Will retry ${retry}`);
    expect(failed('not_pln')).toBe(`Price search failed: the listing is not in PLN. Will retry ${retry}`);
    expect(failed('name_too_short')).toBe(`Price search failed: the product name is too short to search. Will retry ${retry}`);
    expect(failed('product_missing')).toBe(`Price search failed: the product no longer exists. Will retry ${retry}`);
    expect(failed('run_error')).toBe(`Price search failed: something went wrong. Will retry ${retry}`);
    expect(failed('weird_code')).toBe(`Price search failed: something went wrong. Will retry ${retry}`);
    expect(failed(null)).toBe(`Price search failed: something went wrong. Will retry ${retry}`);
  });

  it('leaves the retry clause out when no retry is scheduled', () => {
    expect(lastRunText(run({ status: 'finished', outcome: 'failed', finishedAt, errorCode: 'timeout' }), null, NOW))
      .toBe('Price search failed: the search took too long.');
    expect(lastRunText(run({ status: 'finished', outcome: 'partial', finishedAt, failedTiers: ['same_model_used'] }), null, NOW))
      .toBe('Prices searched 2h ago; same model, used search failed');
  });
});

describe('classLine', () => {
  const row = (patch: Partial<PriceComparable>): PriceComparable => ({ price: 300, note: '', ...patch });

  it('joins the class attributes with their units', () => {
    expect(classLine(row({
      classChecked: true,
      classAttributes: [
        { name: 'resolution', value: '720p', match: 'equal' },
        { name: 'brightness', value: 200, unit: 'ANSI lm', match: 'ratio' },
      ],
    }))).toBe('720p · 200 ANSI lm');
  });

  it('says the class is unchecked when it was not checked', () => {
    expect(classLine(row({ classChecked: false, classAttributes: [] }))).toBe('class unchecked');
  });

  it('is null for a row with nothing to show', () => {
    expect(classLine(row({}))).toBeNull();
    expect(classLine(row({ classChecked: true, classAttributes: [] }))).toBeNull();
  });
});
