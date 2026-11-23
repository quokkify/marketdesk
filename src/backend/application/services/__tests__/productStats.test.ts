import type { ProductStats } from '@shared/types';
import {
  ENOUGH_VIEWS,
  compareByStats,
  isSyncRecordedEventId,
  listingResponseSignal,
  nonSyncViewEventIds,
  needsActionReasons,
  summarizeListingViews,
  summarizeProduct,
} from '../productStats';
import type { ResponseListing, StatsListing } from '../productStats';

const now = new Date('2026-11-22T12:00:00Z');
const ev = (id: string, listingId: string, quantity: number, iso: string) => ({
  id,
  listingId,
  eventType: 'view',
  quantity,
  occurredAt: new Date(iso),
});

describe('summarizeListingViews', () => {
  it('drops the baseline event even inside the window and buckets by UTC day', () => {
    const views = summarizeListingViews(
      [
        ev('b', 'L1', 500, '2026-11-21T15:00:00Z'),
        ev('e1', 'L1', 3, '2026-11-21T20:00:00Z'),
        ev('e2', 'L1', 2, '2026-11-22T10:00:00Z'),
        { ...ev('m', 'L1', 9, '2026-11-22T10:00:00Z'), eventType: 'message' },
      ],
      new Set(['b']),
      now
    );
    expect(views.get('L1')!.delta7d).toBe(5);
    expect(views.get('L1')!.byDay).toHaveLength(14);
    expect(views.get('L1')!.byDay.slice(-2)).toEqual([3, 2]);
  });

  it('ignores events older than the windows', () => {
    const views = summarizeListingViews([ev('o', 'L1', 4, '2026-11-01T00:00:00Z')], new Set(), now);
    expect(views.get('L1')?.delta7d ?? 0).toBe(0);
    expect((views.get('L1')?.byDay ?? []).every((n) => n === 0)).toBe(true);
  });

  it('counts the last 7x24 hours for growth but 14 days for the trend', () => {
    const views = summarizeListingViews(
      [ev('a', 'L1', 4, '2026-11-12T00:00:00Z'), ev('c', 'L1', 1, '2026-11-20T00:00:00Z')],
      new Set(),
      now
    );
    expect(views.get('L1')!.delta7d).toBe(1);
    expect(views.get('L1')!.byDay.reduce((sum, n) => sum + n, 0)).toBe(5);
  });
});

describe('summarizeProduct', () => {
  const live = (over: Partial<StatsListing> = {}): StatsListing => ({
    productId: 'p',
    status: 'live',
    views: 40,
    watchers: 2,
    messages: 1,
    lastSyncAt: new Date('2026-11-22T11:00:00Z'),
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    externalUrl: 'u',
    ...over,
  });

  it('marks a listing synced more than 24 hours ago as stale without growth', () => {
    const s = summarizeProduct(
      [live({ lastSyncAt: new Date('2026-11-21T11:59:00Z') })],
      new Map(),
      ['L1'],
      now
    );
    expect(s.stale).toBe(true);
    expect(s.viewsDelta7d).toBeNull();
  });

  it('marks a never-synced listing as stale', () => {
    const s = summarizeProduct([live({ lastSyncAt: null })], new Map(), ['L1'], now);
    expect(s.stale).toBe(true);
    expect(s.lastSyncAt).toBeNull();
  });

  it('reports zero growth for a fresh listing without view events', () => {
    const s = summarizeProduct([live()], new Map(), ['L1'], now);
    expect(s.viewsDelta7d).toBe(0);
    expect(s.viewsByDay).toEqual(Array(14).fill(0));
  });

  it('sums several listings and keeps the worst status and the live url', () => {
    const s = summarizeProduct(
      [
        live({ views: 10, watchers: 1, messages: 0, publishedAt: null, externalUrl: 'live-url' }),
        live({
          status: 'expired',
          views: 5,
          watchers: null,
          messages: 2,
          lastSyncAt: new Date('2026-11-22T09:00:00Z'),
          publishedAt: null,
          externalUrl: 'old-url',
        }),
      ],
      new Map([
        ['L1', { delta7d: 3, byDay: Array(14).fill(0) }],
        ['L2', { delta7d: 1, byDay: Array(14).fill(0) }],
      ]),
      ['L1', 'L2'],
      now
    );
    expect(s).toMatchObject({
      views: 15,
      watchers: 1,
      messages: 2,
      viewsDelta7d: 4,
      listingStatus: 'expired',
      externalUrl: 'live-url',
      stale: false,
    });
  });
});

describe('needsActionReasons', () => {
  type Row = {
    awaiting?: number;
    listingStatus?: 'live' | 'expired' | 'error' | 'draft';
    viewsDelta7d?: number | null;
    stale?: boolean;
    published?: string;
  };
  const statsFor = (o: Row) => ({
    views: 1,
    watchers: 0,
    messages: 0,
    viewsDelta7d: 'viewsDelta7d' in o ? (o.viewsDelta7d ?? null) : 2,
    viewsByDay: [],
    lastSyncAt: now.toISOString(),
    stale: Boolean(o.stale),
    externalUrl: null,
    listingStatus: o.listingStatus ?? ('live' as const),
    oldestLivePublishedAt: o.published ? new Date(o.published) : null,
  });

  it.each<[string, Row, string[]]>([
    ['buyer waiting', { awaiting: 1 }, ['buyer_waiting']],
    ['expired listing', { listingStatus: 'expired' }, ['listing_problem']],
    ['failing listing', { listingStatus: 'error' }, ['listing_problem']],
    ['no growth for a week', { viewsDelta7d: 0, published: '2026-11-10T00:00:00Z' }, ['no_view_growth']],
    ['young listing', { viewsDelta7d: 0, published: '2026-11-20T00:00:00Z' }, []],
    ['stale listing', { viewsDelta7d: null, stale: true, published: '2026-11-01T00:00:00Z' }, []],
    ['growing listing', { viewsDelta7d: 4, published: '2026-11-01T00:00:00Z' }, []],
    [
      'several reasons in a fixed order',
      { awaiting: 2, listingStatus: 'error', viewsDelta7d: 0, published: '2026-11-01T00:00:00Z' },
      ['buyer_waiting', 'listing_problem'],
    ],
  ])('needs action: %s', (_name, o, expected) => {
    expect(
      needsActionReasons({ productStatus: 'active', awaiting: o.awaiting ?? 0, stats: statsFor(o), now })
    ).toEqual(expected);
  });

  it('flags a waiting buyer on a product without listings', () => {
    expect(needsActionReasons({ productStatus: 'active', awaiting: 1, stats: undefined, now })).toEqual([
      'buyer_waiting',
    ]);
  });

  it('never flags products that are not active', () => {
    const stats = statsFor({ listingStatus: 'expired', viewsDelta7d: 0 });
    expect(needsActionReasons({ productStatus: 'draft', awaiting: 2, stats, now })).toEqual([]);
    expect(needsActionReasons({ productStatus: 'sold', awaiting: 2, stats, now })).toEqual([]);
  });
});

describe('compareByStats', () => {
  it('sorts products without stats last', () => {
    const s = (views: number | null) => ({ views }) as ProductStats;
    expect(compareByStats(s(1), s(5), 'views')).toBeLessThan(0);
    expect(compareByStats(undefined, s(5), 'views')).toBeGreaterThan(0);
    expect(compareByStats(s(null), s(0), 'views')).toBeGreaterThan(0);
    expect(compareByStats(undefined, undefined, 'views')).toBe(0);
  });
});

describe('baseline events', () => {
  // Sync writes deterministic UUID v5 ids; migration seeds of pre-tracking totals get random v4 ids.
  const SYNC_ID = '3f2a9c1e-7b4d-5e21-a9f0-1c2d3e4f5a6b';
  const SEED_ID = '3f2a9c1e-7b4d-4e21-a9f0-1c2d3e4f5a6b';

  it('tells sync-recorded events from seeded totals', () => {
    expect(isSyncRecordedEventId(SYNC_ID)).toBe(true);
    expect(isSyncRecordedEventId(SEED_ID)).toBe(false);
  });

  // Regression guard: a seed written after the first sync (migration replay) showed as a spike,
  // and the first genuine sync delta was dropped as the "earliest" event.
  it('counts every sync delta and no seeded total, whatever their order', () => {
    const events = [
      ev(SYNC_ID, 'L1', 2, '2026-11-20T10:00:00Z'),
      ev(SEED_ID, 'L1', 500, '2026-11-21T10:00:00Z'),
    ];
    const views = summarizeListingViews(events, nonSyncViewEventIds(events), now);
    expect(views.get('L1')!.delta7d).toBe(2);
  });
});

describe('listingResponseSignal', () => {
  const at = new Date('2026-11-23T12:00:00Z');
  const hoursAgo = (hours: number) => new Date(at.getTime() - hours * 3600 * 1000);
  const listing = (over: Partial<ResponseListing> = {}): ResponseListing => ({
    id: 'L1',
    productId: 'p',
    status: 'live',
    views: 17,
    watchers: 0,
    messages: 0,
    conversations: 0,
    lastSyncAt: hoursAgo(1),
    publishedAt: hoursAgo(96),
    externalUrl: 'u',
    ...over,
  });
  const byDay = (lastThree: number[]) => ({
    delta7d: 0,
    byDay: [...Array<number>(10).fill(0), ...lastThree, 5],
  });
  const quiet = byDay([1, 0, 1]);

  it('has no data for stale statistics', () => {
    const signal = listingResponseSignal(
      listing({ lastSyncAt: hoursAgo(25), watchers: 2 }),
      quiet,
      at
    );
    expect(signal.stage).toBe('no_data');
  });

  it('has no data without views', () => {
    expect(listingResponseSignal(listing({ views: null }), quiet, at).stage).toBe('no_data');
  });

  it('has no data when both contact metrics are unknown', () => {
    const signal = listingResponseSignal(
      listing({ watchers: null, conversations: null }),
      quiet,
      at
    );
    expect(signal.stage).toBe('no_data');
  });

  it('is responding with a watcher', () => {
    expect(listingResponseSignal(listing({ watchers: 1 }), quiet, at).stage).toBe('responding');
  });

  it('judges on views when only conversations are unknown', () => {
    const signal = listingResponseSignal(listing({ conversations: null, watchers: 0 }), quiet, at);
    expect(signal.stage).toBe('not_seen');
  });

  it('is too early for a listing younger than 48 hours', () => {
    const signal = listingResponseSignal(listing({ publishedAt: hoursAgo(47) }), quiet, at);
    expect(signal).toMatchObject({ stage: 'too_early', viewsNeeded: null });
  });

  it('is not seen with few views and a low daily average', () => {
    const signal = listingResponseSignal(listing(), quiet, at);
    expect(signal.stage).toBe('not_seen');
    expect(signal.viewsPerDay).toBeCloseTo(0.67, 2);
    expect(signal.hoursLive).toBe(96);
  });

  it('is too early while few views are growing', () => {
    const signal = listingResponseSignal(listing(), byDay([4, 5, 6]), at);
    expect(signal).toMatchObject({ stage: 'too_early', viewsNeeded: ENOUGH_VIEWS });
  });

  it('keeps collecting between the not-seen and enough-views limits', () => {
    const signal = listingResponseSignal(listing({ views: 45 }), quiet, at);
    expect(signal).toMatchObject({ stage: 'too_early', viewsNeeded: ENOUGH_VIEWS });
  });

  it('is seen but not contacted with enough views', () => {
    expect(listingResponseSignal(listing({ views: 80 }), quiet, at).stage).toBe(
      'seen_not_contacted'
    );
  });

  it('is not seen just under 30 views', () => {
    expect(listingResponseSignal(listing({ views: 29 }), quiet, at).stage).toBe('not_seen');
  });

  it('keeps collecting at exactly 30 views', () => {
    const signal = listingResponseSignal(listing({ views: 30 }), quiet, at);
    expect(signal).toMatchObject({ stage: 'too_early', viewsNeeded: ENOUGH_VIEWS });
  });

  it('is not "not seen" at exactly 3 views a day', () => {
    const signal = listingResponseSignal(listing(), byDay([3, 3, 3]), at);
    expect(signal.viewsPerDay).toBe(3);
    expect(signal.stage).not.toBe('not_seen');
  });

  it('is responding with a conversation', () => {
    expect(listingResponseSignal(listing({ conversations: 1 }), quiet, at).stage).toBe(
      'responding'
    );
  });

  it('has no data for a listing that is not live', () => {
    expect(listingResponseSignal(listing({ status: 'expired' }), quiet, at).stage).toBe('no_data');
  });

  it('has no data without a publication date', () => {
    const signal = listingResponseSignal(listing({ publishedAt: null }), quiet, at);
    expect(signal).toMatchObject({ stage: 'no_data', hoursLive: null });
  });

  it('counts a listing without view events as zero views per day', () => {
    expect(listingResponseSignal(listing(), undefined, at)).toMatchObject({
      stage: 'not_seen',
      viewsPerDay: 0,
    });
  });
});
