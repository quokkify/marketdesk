import {
  CROWDED_TOTAL,
  DEEP_POSITION,
  knownFindings,
  locateOwn,
  missingQueryWords,
  probeFindings,
  rankFindings,
  subjectFingerprint,
} from '../listingResponseRules';
import type {
  ProbeCard,
  ResponseFinding,
  ResponseProbe,
  SaleVerdict,
  VerdictCheck,
} from '../../../../shared/types';

const own = { id: 'own-1', title: 'Apple AirPods 4', price: 279 };

const organic = (id: string, price: number | null = null): ProbeCard => ({
  id,
  price,
  promoted: false,
});
const promoted = (id: string): ProbeCard => ({ id, price: null, promoted: true });

const probe = (overrides: Partial<ResponseProbe>): ResponseProbe => ({
  query: 'apple airpods',
  status: 'ok',
  total: 100,
  cards: [],
  firstPageSize: 40,
  ...overrides,
});

const finding = (
  code: ResponseFinding['code'],
  evidence: ResponseFinding['evidence'] = {}
): ResponseFinding => ({
  code,
  message: code,
  action: null,
  evidence,
});

const verdictWith = (
  checks: SaleVerdict['checks'],
  completedAt: string | null = '2026-11-22T10:00:00.000Z'
): SaleVerdict => ({
  id: 'v1',
  productId: 'p1',
  listingId: 'l1',
  graphVersion: 'g1',
  scope: ['price'],
  status: 'completed',
  overall: 'fix',
  checks,
  researchRunId: null,
  errorCode: null,
  createdAt: '2026-11-22T09:00:00.000Z',
  completedAt,
});

const priceCheck = (status: VerdictCheck['status'], eventIds: string[]): VerdictCheck => ({
  check: 'price',
  status,
  reasons: [{ code: 'above_ceiling', message: 'The price is above what the market pays' }],
  checkedAt: '2026-11-22T10:00:00.000Z',
  refs: { eventIds },
});

describe('locateOwn', () => {
  it('ignores promoted cards when counting position', () => {
    expect(locateOwn([promoted('a'), promoted('b'), organic('own-1')], 'own-1')).toEqual({
      position: 1,
      checked: 1,
    });
  });

  it('returns a null position when the own advert is only promoted', () => {
    expect(locateOwn([organic('a'), promoted('own-1')], 'own-1')).toEqual({
      position: null,
      checked: 1,
    });
  });

  it('prefers the organic copy over a promoted one', () => {
    expect(locateOwn([promoted('own-1'), organic('a'), organic('own-1')], 'own-1')).toEqual({
      position: 2,
      checked: 2,
    });
  });

  it('counts organic cards read when the own advert is 57th of 90', () => {
    const cards = Array.from({ length: 90 }, (_, i) => organic(i === 56 ? 'own-1' : `c${i}`));
    expect(locateOwn(cards, 'own-1')).toEqual({ position: 57, checked: 90 });
  });
});

describe('missingQueryWords', () => {
  it('matches words ignoring case and diacritics', () => {
    expect(missingQueryWords('słuchawki airpods', 'Apple AirPods 4 Sluchawki')).toEqual([]);
  });

  it('returns normalised absent words in query order', () => {
    expect(missingQueryWords('słuchawki bezprzewodowe', 'Apple AirPods 4')).toEqual([
      'sluchawki',
      'bezprzewodowe',
    ]);
  });

  it('skips short words and duplicates', () => {
    expect(
      missingQueryWords('do apple apple bezprzewodowe bezprzewodowe', 'Apple AirPods')
    ).toEqual(['bezprzewodowe']);
  });

  it('accepts a title word that starts with the query word', () => {
    expect(missingQueryWords('airpod', 'Apple AirPods 4')).toEqual([]);
  });

  it('does not match a query word inside another word', () => {
    expect(missingQueryWords('pods', 'Apple AirPods 4')).toEqual(['pods']);
  });
});

describe('probeFindings', () => {
  it('returns nothing for a failed probe', () => {
    expect(probeFindings(probe({ status: 'failed', cards: [organic('x')] }), own)).toEqual([]);
  });

  it('returns nothing when no cards were read', () => {
    expect(probeFindings(probe({ cards: [] }), own)).toEqual([]);
  });

  it('returns nothing when only the own card is present', () => {
    expect(probeFindings(probe({ cards: [organic('own-1', 279)], firstPageSize: 1 }), own)).toEqual(
      []
    );
  });

  it('reports not_in_results when own is absent among other cards', () => {
    const result = probeFindings(
      probe({ cards: [organic('a'), organic('b'), promoted('own-1')], firstPageSize: 3 }),
      own
    );
    const found = result.find((f) => f.code === 'not_in_results');
    expect(found).toMatchObject({
      action: 'edit_title',
      evidence: { query: 'apple airpods', checked: 2, total: 100 },
    });
  });

  it('reports deep_in_results with a null total', () => {
    const cards = Array.from({ length: 30 }, (_, i) => organic(i === 24 ? 'own-1' : `c${i}`));
    const result = probeFindings(probe({ cards, total: null, firstPageSize: 30 }), own);
    const found = result.find((f) => f.code === 'deep_in_results');
    expect(found).toMatchObject({
      action: 'refresh_advert',
      evidence: { query: 'apple airpods', position: 25, checked: 30, total: null },
    });
  });

  it('does not report deep_in_results at the threshold', () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      organic(i === DEEP_POSITION - 1 ? 'own-1' : `c${i}`)
    );
    const result = probeFindings(probe({ cards, firstPageSize: 30 }), own);
    expect(result.map((f) => f.code)).not.toContain('deep_in_results');
  });

  it('reports title_misses_query_words', () => {
    const result = probeFindings(
      probe({
        query: 'słuchawki bezprzewodowe',
        cards: [organic('own-1'), organic('a')],
        firstPageSize: 2,
      }),
      own
    );
    expect(result.find((f) => f.code === 'title_misses_query_words')).toMatchObject({
      action: 'edit_title',
      evidence: { query: 'słuchawki bezprzewodowe', missingWords: ['sluchawki', 'bezprzewodowe'] },
    });
  });

  it('reports price_high_among_top from first-page priced organic cards', () => {
    const cards = [
      organic('a', null),
      organic('b', 200),
      organic('c', 210),
      organic('d', 220),
      organic('own-1', 279),
    ];
    const result = probeFindings(probe({ cards, firstPageSize: 5 }), own);
    expect(result.find((f) => f.code === 'price_high_among_top')).toMatchObject({
      action: 'review_price',
      evidence: { ownPrice: 279, lowPrice: 200, highPrice: 220 },
    });
  });

  it('skips the price finding with only two priced cards', () => {
    const cards = [organic('b', 200), organic('c', 210), organic('own-1', 279)];
    const result = probeFindings(probe({ cards, firstPageSize: 3 }), own);
    expect(result.map((f) => f.code)).not.toContain('price_high_among_top');
  });

  it('does not use cards beyond firstPageSize for the price', () => {
    const cards = [organic('b', 200), organic('c', 210), organic('d', 220), organic('own-1', 279)];
    const result = probeFindings(probe({ cards, firstPageSize: 2 }), own);
    expect(result.map((f) => f.code)).not.toContain('price_high_among_top');
  });

  it('does not report a price finding when own is not above the median', () => {
    const cards = [organic('b', 200), organic('c', 300), organic('d', 400), organic('own-1', 279)];
    const result = probeFindings(probe({ cards, firstPageSize: 4 }), own);
    expect(result.map((f) => f.code)).not.toContain('price_high_among_top');
  });

  it('reports crowded_market only above the threshold', () => {
    const cards = [organic('own-1'), organic('a')];
    const crowded = probeFindings(
      probe({ cards, total: CROWDED_TOTAL + 1, firstPageSize: 2 }),
      own
    );
    expect(crowded.find((f) => f.code === 'crowded_market')).toMatchObject({ action: null });
    const calm = probeFindings(probe({ cards, total: CROWDED_TOTAL, firstPageSize: 2 }), own);
    expect(calm.map((f) => f.code)).not.toContain('crowded_market');
  });
});

describe('knownFindings', () => {
  const changedBefore = new Date('2026-11-22T09:00:00.000Z');

  it('reports no_verdict when there is no verdict', () => {
    expect(knownFindings(null, changedBefore)).toEqual([
      expect.objectContaining({ code: 'no_verdict', action: 'run_analyze' }),
    ]);
  });

  it('turns a fix reason into a verdict_reason that opens the proposal', () => {
    const result = knownFindings(verdictWith({ price: priceCheck('fix', ['e1']) }), changedBefore);
    expect(result).toEqual([
      {
        code: 'verdict_reason',
        message: 'The price is above what the market pays',
        action: 'open_proposal',
        evidence: { verdictCheck: 'price', verdictReasonCode: 'above_ceiling', eventIds: ['e1'] },
      },
    ]);
  });

  it('asks to run analyze when the reason has no event ids', () => {
    const result = knownFindings(
      verdictWith({ price: priceCheck('needs_human', []) }),
      changedBefore
    );
    expect(result[0]).toMatchObject({ code: 'verdict_reason', action: 'run_analyze' });
  });

  it('ignores ready and pending checks', () => {
    const result = knownFindings(
      verdictWith({
        price: priceCheck('ready', []),
        photos: { ...priceCheck('pending', []), check: 'photos' },
      }),
      changedBefore
    );
    expect(result).toEqual([]);
  });

  it('adds verdict_out_of_date when the listing changed after the verdict', () => {
    const result = knownFindings(verdictWith({}), new Date('2026-11-22T11:00:00.000Z'));
    expect(result.map((f) => f.code)).toEqual(['verdict_out_of_date']);
  });

  it('does not flag staleness without a completion time', () => {
    expect(knownFindings(verdictWith({}, null), new Date('2026-11-22T11:00:00.000Z'))).toEqual([]);
  });
});

describe('rankFindings', () => {
  it('orders by code priority', () => {
    const ranked = rankFindings([
      finding('probe_failed'),
      finding('crowded_market'),
      finding('no_verdict'),
      finding('verdict_out_of_date'),
      finding('title_misses_query_words', { missingWords: ['a'] }),
      finding('price_high_among_top'),
      finding('deep_in_results'),
      finding('not_in_results'),
      finding('verdict_reason'),
    ]);
    expect(ranked.map((f) => f.code)).toEqual([
      'verdict_reason',
      'not_in_results',
      'deep_in_results',
      'price_high_among_top',
      'title_misses_query_words',
      'verdict_out_of_date',
      'no_verdict',
      'crowded_market',
      'probe_failed',
    ]);
  });

  it('drops findings with the same code and equal evidence', () => {
    const ranked = rankFindings([
      finding('not_in_results', { query: 'q' }),
      finding('not_in_results', { query: 'q' }),
    ]);
    expect(ranked).toHaveLength(1);
  });

  it('keeps findings with different evidence', () => {
    const ranked = rankFindings([
      finding('not_in_results', { query: 'q1' }),
      finding('not_in_results', { query: 'q2' }),
    ]);
    expect(ranked).toHaveLength(2);
  });

  it('merges missing words across queries into one finding', () => {
    const ranked = rankFindings([
      finding('title_misses_query_words', { query: 'q1', missingWords: ['alpha', 'beta'] }),
      finding('title_misses_query_words', { query: 'q2', missingWords: ['beta', 'gamma'] }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].evidence.missingWords).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('subjectFingerprint', () => {
  const input = { title: 'Apple AirPods 4', price: 279, categoryId: '123' };

  it('is stable for the same input', () => {
    expect(subjectFingerprint(input)).toBe(subjectFingerprint({ ...input }));
  });

  it('differs when the price differs', () => {
    expect(subjectFingerprint({ ...input, price: 250 })).not.toBe(subjectFingerprint(input));
  });

  it('differs when the title or category differs', () => {
    expect(subjectFingerprint({ ...input, title: 'Other' })).not.toBe(subjectFingerprint(input));
    expect(subjectFingerprint({ ...input, categoryId: null })).not.toBe(subjectFingerprint(input));
  });
});
