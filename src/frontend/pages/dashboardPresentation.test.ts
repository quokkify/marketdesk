import type { HermesEvent, Listing, Marketplace, Product } from '@shared/types';
import type { AnalyticsOverview } from '../state/api';
import {
  DASHBOARD_ATTENTION_EMPTY,
  DASHBOARD_ATTENTION_LIMIT,
  DASHBOARD_DELTA_LABEL,
  DASHBOARD_EVENT_LIMIT,
  DASHBOARD_QUICK_ACTIONS,
  DASHBOARD_SECTION_LIMIT,
  attentionBadgeLabel,
  attentionCount,
  attentionItems,
  attentionOverflowLabel,
  dashboardActivityEvents,
  dashboardKpis,
  dashboardRevenueRange,
  hermesActivityEmptyState,
  hermesSeverityTone,
  isHermesRunActive,
  isSandboxMarketplace,
  marketplaceDisplayName,
  marketplaceOperationalSummary,
  marketplacePresentation,
  planSyncAll,
  salesChartSummary,
  shouldShowHermesRunning,
  splitDashboardEvents,
  syncAllToast,
} from './dashboardPresentation';

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-1',
    workspaceId: 'workspace-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'hourly',
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function event(index: number, status: HermesEvent['status'] = 'applied'): HermesEvent {
  return {
    id: `event-${index}`,
    workspaceId: 'workspace-1',
    type: 'suggested_better_title',
    severity: 'info',
    status,
    title: `Event ${index}`,
    proposedChange: null,
    createdAt: `2026-07-18T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
}

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    workspaceId: 'workspace-1',
    sku: `SKU-${id}`,
    name: `Product ${id}`,
    description: 'A product used in a test.',
    costPrice: null,
    sellingPrice: 100,
    condition: 'good',
    category: 'Electronics',
    status: 'attention',
    tags: [],
    images: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function listing(id: string, overrides: Partial<Listing> = {}): Listing {
  return {
    id,
    productId: `product-${id}`,
    productName: `Product ${id}`,
    marketplaceId: 'marketplace-1',
    price: 100,
    status: 'live',
    views: 0,
    watchers: 0,
    conversations: 0,
    messages: 0,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

const previousPeriod = {
  currency: 'PLN',
  revenue: 1000,
  profit: 400,
  totalViews: 90,
  sales: 2,
  conversion: 2,
};

function overview(overrides: Partial<AnalyticsOverview> = {}): AnalyticsOverview {
  return {
    workspaceId: 'workspace-1',
    productCount: 4,
    productsByStatus: { draft: 1, active: 2, attention: 1, sold: 0 },
    listingCount: 5,
    listingsByStatus: { live: 3, draft: 1, expired: 1, error: 0 },
    liveListingCount: 3,
    totalViews: 120,
    totalWatchers: 4,
    totalMessages: 1,
    inventoryValue: 1050,
    revenue: 1200,
    profit: 300,
    sales: 3,
    conversion: 2.5,
    currency: 'PLN',
    previous: previousPeriod,
    ...overrides,
  };
}

describe('dashboard presentation contracts', () => {
  it('requests an inclusive 30-day daily revenue range', () => {
    expect(dashboardRevenueRange(new Date('2026-07-18T23:59:59.000Z'))).toEqual({
      from: '2026-06-19',
      to: '2026-07-18',
      interval: 'day',
    });
  });

  it('keeps quick actions truthful: real routes plus Sync all backed by the sync endpoint', () => {
    expect(DASHBOARD_QUICK_ACTIONS).toEqual([
      { key: 'add', label: 'Add product', kind: 'route', path: '/products?newProduct=1' },
      { key: 'sync', label: 'Sync all', kind: 'sync-all' },
      { key: 'analyze', label: 'Analyze a product', kind: 'route', path: '/products' },
      { key: 'analytics', label: 'View analytics', kind: 'route', path: '/analytics' },
    ]);
    expect(DASHBOARD_QUICK_ACTIONS.some((action) => action.label === 'Run Hermes')).toBe(false);
  });

  it('never presents a disconnected marketplace as connected', () => {
    expect(marketplacePresentation(marketplace({ connected: false, errorCount: 4 }))).toEqual({
      statusLabel: 'Not connected',
      statusColor: 'default',
    });
  });

  it('surfaces connected marketplace errors before a healthy state', () => {
    expect(marketplacePresentation(marketplace({ errorCount: 2 }))).toEqual({
      statusLabel: 'Needs attention',
      statusColor: 'warning',
    });
    expect(marketplacePresentation(marketplace())).toEqual({
      statusLabel: 'Connected',
      statusColor: 'success',
    });
  });

  it('does not present the synthetic marketplace capacity default as provider truth', () => {
    const summary = marketplaceOperationalSummary(marketplace({ capacity: 100, errorCount: 2 }));

    expect(summary).toBe('hourly sync · 2 errors');
    expect(summary).not.toContain('100');
    expect(summary).not.toContain('capacity');
  });

  it('shows an active Hermes indicator only for actual in-flight lifecycle states', () => {
    expect(isHermesRunActive([event(1, 'pending_review'), event(2, 'applied')])).toBe(false);
    expect(isHermesRunActive([event(1, 'applying')])).toBe(true);
    expect(isHermesRunActive([event(1, 'reverting')])).toBe(true);
  });

  it('suppresses the Hermes running indicator until the active-event query succeeds', () => {
    const activeEvents = [event(1, 'applying')];

    expect(shouldShowHermesRunning(activeEvents, { isLoading: true, isError: false })).toBe(false);
    expect(shouldShowHermesRunning(activeEvents, { isLoading: false, isError: true })).toBe(false);
    expect(shouldShowHermesRunning([], { isLoading: false, isError: false })).toBe(false);
    expect(shouldShowHermesRunning(activeEvents, { isLoading: false, isError: false })).toBe(true);
  });

  it('bounds the dashboard card and timeline without reordering server results', () => {
    const events = Array.from({ length: 12 }, (_, index) => event(index));
    const result = splitDashboardEvents(events);

    expect(result.latest).toHaveLength(DASHBOARD_SECTION_LIMIT);
    expect(result.timeline).toHaveLength(DASHBOARD_EVENT_LIMIT - DASHBOARD_SECTION_LIMIT);
    expect(result.latest.map((item) => item.id)).toEqual([
      'event-0',
      'event-1',
      'event-2',
      'event-3',
    ]);
    expect(result.timeline.map((item) => item.id)).toEqual([
      'event-4',
      'event-5',
      'event-6',
      'event-7',
    ]);
  });

  it('keeps pending SEO recommendations in the compact review queue instead of duplicating them in activity', () => {
    const pendingSeo = event(1, 'pending_review');
    const appliedSeo = event(2, 'applied');
    const operational = {
      ...event(3, 'pending_review'),
      type: 'price_decreased' as const,
      proposedChange: { kind: 'price' as const, from: 100, to: 90, currency: 'PLN' },
    };

    expect(
      dashboardActivityEvents([pendingSeo, appliedSeo, operational]).map((item) => item.id)
    ).toEqual([appliedSeo.id, operational.id]);
  });

  it('maps Hermes severity to a theme tone so the dot never relies on raw colours', () => {
    expect(hermesSeverityTone('info')).toBe('info');
    expect(hermesSeverityTone('success')).toBe('success');
    expect(hermesSeverityTone('warning')).toBe('warning');
    expect(hermesSeverityTone('critical')).toBe('error');
  });
});

describe('dashboard KPI row', () => {
  it('maps Revenue, Profit, Active listings and Needs attention from the overview', () => {
    const kpis = dashboardKpis({ overview: overview(), criticalPendingTotal: 2, currency: 'PLN' });

    expect(kpis.map((kpi) => [kpi.key, kpi.label, kpi.value])).toEqual([
      ['revenue', 'Revenue', '1 200 zł'],
      ['profit', 'Profit', '300 zł'],
      ['activeListings', 'Active listings', '3'],
      ['attention', 'Needs attention', '4'],
    ]);
  });

  it('shows inventory value only as a caption under Revenue, in the workspace currency', () => {
    const kpis = dashboardKpis({
      overview: overview({ currency: 'EUR', revenue: 10, profit: 4, previous: null }),
      criticalPendingTotal: 0,
      currency: 'PLN',
    });

    expect(kpis[0].value).toBe('10 EUR');
    expect(kpis[0].caption).toBe('Inventory value 1 050 zł');
    expect(kpis.slice(1).map((kpi) => kpi.caption)).toEqual([undefined, undefined, undefined]);
  });

  it('computes revenue and profit deltas against the previous period', () => {
    const [revenue, profit] = dashboardKpis({
      overview: overview(),
      criticalPendingTotal: 0,
      currency: 'PLN',
    });

    expect(revenue.deltaPct).toBe(20);
    expect(profit.deltaPct).toBe(-25);
  });

  it('measures a swing out of a loss against the size of that loss', () => {
    const [, profit] = dashboardKpis({
      overview: overview({ profit: 50, previous: { ...previousPeriod, profit: -100 } }),
      criticalPendingTotal: 0,
      currency: 'PLN',
    });

    expect(profit.deltaPct).toBe(150);
  });

  it('never promises a delta for fields the previous period does not carry', () => {
    const kpis = dashboardKpis({ overview: overview(), criticalPendingTotal: 2, currency: 'PLN' });

    expect(kpis.find((kpi) => kpi.key === 'activeListings')?.deltaPct).toBeUndefined();
    expect(kpis.find((kpi) => kpi.key === 'attention')?.deltaPct).toBeUndefined();
  });

  it.each([
    ['the previous period is missing', { previous: null }],
    [
      'previous revenue and profit are unknown',
      { previous: { ...previousPeriod, revenue: null, profit: null } },
    ],
    [
      'previous revenue and profit are zero',
      { previous: { ...previousPeriod, revenue: 0, profit: 0 } },
    ],
    ['the currencies differ', { previous: { ...previousPeriod, currency: 'EUR' } }],
    ['current totals are unknown', { revenue: null, profit: null }],
  ] as Array<[string, Partial<AnalyticsOverview>]>)(
    'omits revenue and profit deltas when %s',
    (_name, patch) => {
      const [revenue, profit] = dashboardKpis({
        overview: overview(patch),
        criticalPendingTotal: 0,
        currency: 'PLN',
      });

      expect(revenue.deltaPct).toBeUndefined();
      expect(profit.deltaPct).toBeUndefined();
    }
  );

  it('shows a dash for unknown totals instead of a misleading zero', () => {
    const [revenue, profit] = dashboardKpis({
      overview: overview({ revenue: null, profit: null }),
      criticalPendingTotal: 0,
      currency: 'PLN',
    });

    expect(revenue.value).toBe('—');
    expect(profit.value).toBe('—');
  });

  it('shows a dash for every KPI while the overview is unavailable', () => {
    const kpis = dashboardKpis({ overview: undefined, criticalPendingTotal: 3, currency: 'PLN' });

    expect(kpis.map((kpi) => kpi.value)).toEqual(['—', '—', '—', '—']);
    expect(kpis.every((kpi) => kpi.deltaPct === undefined && kpi.caption === undefined)).toBe(true);
  });

  it('keeps Needs attention unknown until the critical-event count is known', () => {
    const kpis = dashboardKpis({
      overview: overview(),
      criticalPendingTotal: undefined,
      currency: 'PLN',
    });

    expect(kpis.find((kpi) => kpi.key === 'attention')?.value).toBe('—');
    expect(kpis.find((kpi) => kpi.key === 'activeListings')?.value).toBe('3');
  });

  it('shows zeros in the workspace currency for a brand-new workspace', () => {
    const kpis = dashboardKpis({
      overview: overview({
        revenue: 0,
        profit: 0,
        currency: null,
        inventoryValue: 0,
        liveListingCount: 0,
        productsByStatus: { draft: 0, active: 0, attention: 0, sold: 0 },
        listingsByStatus: { live: 0, draft: 0, expired: 0, error: 0 },
        previous: { ...previousPeriod, currency: null, revenue: 0, profit: 0 },
      }),
      criticalPendingTotal: 0,
      currency: 'PLN',
    });

    expect(kpis.map((kpi) => kpi.value)).toEqual(['0 zł', '0 zł', '0', '0']);
    expect(kpis.map((kpi) => kpi.deltaPct)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('gives each KPI a theme tone for its soft icon', () => {
    const kpis = dashboardKpis({ overview: overview(), criticalPendingTotal: 0, currency: 'PLN' });

    expect(kpis.map((kpi) => kpi.tone)).toEqual(['primary', 'success', 'info', 'warning']);
  });

  it('describes the real comparison window of the previous period', () => {
    expect(DASHBOARD_DELTA_LABEL).toBe('vs previous 30 days');
  });
});

describe('dashboard needs-attention queue', () => {
  it('counts attention products, expired listings and pending critical events', () => {
    expect(attentionCount(overview(), 2)).toBe(4);
    expect(
      attentionCount(
        overview({
          productsByStatus: { draft: 0, active: 0, attention: 0, sold: 0 },
          listingsByStatus: { live: 0, draft: 0, expired: 0, error: 3 },
        }),
        0
      )
    ).toBe(0);
  });

  it('stays unknown until every source is known', () => {
    expect(attentionCount(undefined, 2)).toBeUndefined();
    expect(attentionCount(overview(), undefined)).toBeUndefined();
  });

  it('lists critical events first, then expired listings, then products needing review', () => {
    const alerts: HermesEvent[] = [
      {
        ...event(1, 'pending_review'),
        severity: 'critical',
        type: 'competitor_price_detected',
        title: 'Competitor price drop detected',
        detail: '30 zł below yours',
        productId: 'product-9',
      },
      {
        ...event(2, 'pending_review'),
        severity: 'critical',
        type: 'needs_relisting',
        title: 'Listing needs relisting',
      },
    ];

    const items = attentionItems({
      criticalEvents: alerts,
      listings: [
        listing('live-1'),
        listing('exp-1', {
          status: 'expired',
          productName: 'Camera kit',
          productId: 'product-camera',
        }),
        listing('draft-1', { status: 'draft' }),
      ],
      attentionProducts: [product('p3', { name: 'Keyboard' })],
    });

    expect(items).toEqual([
      {
        key: 'event:event-1',
        title: 'Competitor price drop detected',
        reason: '30 zł below yours',
        severity: 'critical',
        path: '/products/product-9',
      },
      {
        key: 'event:event-2',
        title: 'Listing needs relisting',
        reason: 'Needs relisting',
        severity: 'critical',
        path: '/hermes',
      },
      {
        key: 'listing:exp-1',
        title: 'Camera kit',
        reason: 'Listing expired',
        severity: 'warning',
        path: '/products/product-camera',
      },
      {
        key: 'product:p3',
        title: 'Keyboard',
        reason: 'Product requires review',
        severity: 'warning',
        path: '/products/p3',
      },
    ]);
  });

  it('takes only expired listings from an unfiltered listing page', () => {
    const items = attentionItems({
      criticalEvents: [],
      listings: [
        listing('a', { status: 'live' }),
        listing('b', { status: 'draft' }),
        listing('c', { status: 'error' }),
        listing('d', { status: 'expired' }),
      ],
      attentionProducts: [],
    });

    expect(items.map((item) => item.key)).toEqual(['listing:d']);
  });

  it('falls back to the SKU, then a generic title, when an expired listing has no product name', () => {
    const items = attentionItems({
      criticalEvents: [],
      listings: [
        listing('x', { status: 'expired', productName: undefined, productSku: 'SKU-X' }),
        listing('y', { status: 'expired', productName: undefined, productSku: undefined }),
      ],
      attentionProducts: [],
    });

    expect(items.map((item) => item.title)).toEqual(['SKU-X', 'Untitled listing']);
  });

  it('encodes ids that end up in a route', () => {
    const items = attentionItems({
      criticalEvents: [],
      listings: [],
      attentionProducts: [product('a/b')],
    });

    expect(items[0].path).toBe('/products/a%2Fb');
  });

  it('bounds the queue without reordering sources', () => {
    const products = Array.from({ length: DASHBOARD_ATTENTION_LIMIT + 3 }, (_, i) =>
      product(`p${i}`)
    );

    expect(
      attentionItems({ criticalEvents: [], listings: [], attentionProducts: products })
    ).toHaveLength(DASHBOARD_ATTENTION_LIMIT);
    expect(
      attentionItems({
        criticalEvents: [event(1, 'pending_review')],
        listings: [],
        attentionProducts: products,
        limit: 2,
      }).map((item) => item.key)
    ).toEqual(['event:event-1', 'product:p0']);
  });

  it('says how many items the bounded list leaves out', () => {
    expect(attentionOverflowLabel(6, 4)).toBe('2 more items need attention');
    expect(attentionOverflowLabel(5, 4)).toBe('1 more item needs attention');
    expect(attentionOverflowLabel(3, 0)).toBe('3 items need attention');
    expect(attentionOverflowLabel(4, 4)).toBeUndefined();
    expect(attentionOverflowLabel(2, 4)).toBeUndefined();
    expect(attentionOverflowLabel(undefined, 4)).toBeUndefined();
  });

  it('labels the header badge with a pluralised item count', () => {
    expect(attentionBadgeLabel(1)).toBe('1 item');
    expect(attentionBadgeLabel(6)).toBe('6 items');
    expect(attentionBadgeLabel(0)).toBe('0 items');
  });

  it('keeps the all-clear copy to a single state title', () => {
    expect(DASHBOARD_ATTENTION_EMPTY.title).toBe('All clear');
  });
});

describe('dashboard marketplace and Hermes states', () => {
  it('flags sandbox marketplaces and labels them wherever the name is shown', () => {
    const sandboxed: Marketplace & { sandbox: boolean } = { ...marketplace(), sandbox: true };

    expect(isSandboxMarketplace(marketplace())).toBe(false);
    expect(isSandboxMarketplace(sandboxed)).toBe(true);
    expect(marketplaceDisplayName(marketplace())).toBe('OLX');
    expect(marketplaceDisplayName(sandboxed)).toBe('OLX (Sandbox)');
  });

  it('invites connecting a marketplace only while none is connected', () => {
    const empty = hermesActivityEmptyState(false);
    expect(empty.title).toBe('Connect a marketplace to start');
    expect(empty.action).toEqual({ label: 'Connect marketplace', path: '/marketplaces' });

    const idle = hermesActivityEmptyState(true);
    expect(idle.title).toBe('No Hermes activity yet');
    expect(idle.action).toEqual({ label: 'Analyze a product', path: '/products' });
    expect(`${idle.title} ${idle.description}`).not.toContain('Connect a marketplace');
  });

  it('summarises the sales chart for assistive technology from the same 30-day totals', () => {
    expect(salesChartSummary(overview(), 'PLN')).toBe(
      'Revenue and profit over the last 30 days: revenue 1 200 zł, profit 300 zł.'
    );
    expect(salesChartSummary(overview({ profit: null }), 'PLN')).toBe(
      'Revenue and profit over the last 30 days: revenue 1 200 zł, profit unavailable.'
    );
    expect(salesChartSummary(overview({ revenue: null, profit: null }), 'PLN')).toBe(
      'Revenue and profit over the last 30 days: revenue unavailable, profit unavailable.'
    );
    expect(salesChartSummary(undefined, 'PLN')).toBe(
      'Revenue and profit over the last 30 days: totals are unavailable.'
    );
  });
});

describe('dashboard Sync all', () => {
  it('syncs only connected marketplaces', () => {
    const olx = marketplace();
    const allegro = marketplace({ id: 'marketplace-2', key: 'allegro', name: 'Allegro' });
    const plan = planSyncAll([olx, { ...allegro, connected: false }]);

    expect(plan.targets).toEqual([olx]);
    expect(plan.disabledReason).toBeUndefined();
  });

  it('is disabled with a reason until a marketplace is connected', () => {
    expect(planSyncAll([marketplace({ connected: false })])).toEqual({
      targets: [],
      disabledReason: 'Connect a marketplace first',
    });
    expect(planSyncAll([])).toEqual({
      targets: [],
      disabledReason: 'Connect a marketplace first',
    });
  });

  it('is disabled while marketplaces are not loaded', () => {
    expect(planSyncAll(undefined)).toEqual({
      targets: [],
      disabledReason: 'Marketplaces are not loaded yet',
    });
  });

  it('reports a started sync, naming sandbox marketplaces as such', () => {
    const sandboxed: Marketplace & { sandbox: boolean } = { ...marketplace(), sandbox: true };

    expect(syncAllToast([{ marketplace: marketplace() }])).toEqual({
      message: 'OLX sync started.',
      severity: 'success',
    });
    expect(syncAllToast([{ marketplace: sandboxed }])).toEqual({
      message: 'OLX (Sandbox) sync started.',
      severity: 'success',
    });
    expect(
      syncAllToast([
        { marketplace: marketplace() },
        { marketplace: marketplace({ id: 'marketplace-2', name: 'Allegro' }) },
      ])
    ).toEqual({ message: 'Sync started for 2 marketplaces.', severity: 'success' });
  });

  it('warns about partial failure and names the marketplaces that failed', () => {
    expect(
      syncAllToast([
        { marketplace: marketplace() },
        { marketplace: marketplace({ id: 'marketplace-2', name: 'Allegro' }), error: 'Boom' },
      ])
    ).toEqual({
      message: 'Sync started for 1 of 2 marketplaces. Failed: Allegro.',
      severity: 'warning',
    });
  });

  it('reports total failure as an error with the first reason', () => {
    expect(syncAllToast([{ marketplace: marketplace(), error: 'Rate limited' }])).toEqual({
      message: 'OLX sync failed: Rate limited',
      severity: 'error',
    });
    expect(
      syncAllToast([
        { marketplace: marketplace(), error: 'Rate limited' },
        { marketplace: marketplace({ id: 'marketplace-2', name: 'Allegro' }), error: 'Boom' },
      ])
    ).toEqual({ message: 'Sync failed for 2 marketplaces: Rate limited', severity: 'error' });
  });

  it('is total for an empty run', () => {
    expect(syncAllToast([])).toEqual({
      message: 'No connected marketplaces to sync.',
      severity: 'warning',
    });
  });
});
