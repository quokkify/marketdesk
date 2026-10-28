import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Theme } from '@mui/material/styles';
import type {
  CategoryRecreationChangePayload,
  HermesEvent,
  ProductCategoryConflictChangePayload,
} from '@shared/types';
import { darkTheme } from '../../theme/darkTheme';
import { lightTheme } from '../../theme/lightTheme';
import {
  CategoryRecreationReview,
  HermesEventCard,
  HermesEventTypeIcon,
  HermesLifecycleCaption,
  ProposedChangeDiff,
  hermesLifecycleCopy,
} from './HermesEventCard';
import type { HermesEventCardProps } from './HermesEventCard';

jest.mock('../../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => 'PLN',
}));

jest.mock('../../services/hooks/index.js', () => ({
  useApproveHermesEvent: () => [jest.fn(), { isLoading: false }],
  useDismissHermesEvent: () => [jest.fn(), { isLoading: false }],
  useExecuteCategoryRecreationOperation: () => [jest.fn(), { isLoading: false }],
}));

const change: CategoryRecreationChangePayload = {
  kind: 'category_recreation',
  listingId: 'listing-1085545830',
  currentCategory: {
    providerCategoryId: 'headphones-44',
    name: 'Wireless headphones',
    path: ['Electronics', 'Audio equipment', 'Headphones', 'Wireless headphones'],
    source: 'provider_taxonomy',
    confidence: 1,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
    taxonomyStaleAt: '2026-07-16T00:00:00.000Z',
  },
  proposedCategory: {
    providerCategoryId: 'projectors-91',
    name: 'Projectors',
    path: ['Electronics', 'TV and video', 'Projectors'],
    source: 'provider_taxonomy',
    confidence: 0.94,
    isLeaf: true,
    taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
    taxonomyStaleAt: '2026-07-16T00:00:00.000Z',
  },
  operations: [
    {
      kind: 'delist',
      intentId: 'delist-intent-1',
      status: 'pending_review',
      providerSideEffectAllowed: false,
      quotaUnitsRestored: 0,
      availableActions: [
        {
          kind: 'approve',
          method: 'POST',
          href: '/hermes/category-correction-operations/delist-intent-1/approve',
          label: 'Review delist',
        },
      ],
    },
    {
      kind: 'recreate',
      intentId: 'recreate-intent-1',
      status: 'blocked_pending_quota_review',
      providerSideEffectAllowed: false,
      quotaGuardRequired: true,
      quota: {
        status: 'unknown',
        cycleStartedAt: '2026-07-15T00:00:00.000Z',
        cycleEndsAt: '2026-08-14T00:00:00.000Z',
        remaining: null,
        paidRisk: true,
        reason: 'OLX has not provided authoritative remaining quota.',
      },
    },
  ],
};

describe('CategoryRecreationReview', () => {
  it('renders exact current/proposed categories and separate durable operations without generic Apply', () => {
    const html = renderToStaticMarkup(<CategoryRecreationReview change={change} />);

    expect(html).toContain('headphones-44');
    expect(html).toContain('Electronics → Audio equipment → Headphones → Wireless headphones');
    expect(html).toContain('projectors-91');
    expect(html).toContain('Electronics → TV and video → Projectors');
    expect(html).toContain('Delist current advert');
    expect(html).toContain('Recreate advert');
    expect(html).toContain('pending review');
    expect(html).toContain('blocked pending quota review');
    expect(html).toContain('Review delist');
    expect(html).not.toContain('>Apply<');
  });

  it('states quota uncertainty, cycle, remaining state, paid risk, and deletion semantics honestly', () => {
    const html = renderToStaticMarkup(<CategoryRecreationReview change={change} />);

    expect(html).toContain('15 Jul 2026');
    expect(html).toContain('14 Aug 2026');
    expect(html).toContain('Unknown');
    expect(html).toContain('Paid placement risk');
    expect(html).toContain('does not restore');
    expect(html).toContain('OLX has not provided authoritative remaining quota.');
    expect(html).toContain('No durable recreate action is available');
  });
});

describe('product category conflict review', () => {
  it('renders the unchanged current category and every exact candidate source', () => {
    const conflict: ProductCategoryConflictChangePayload = {
      kind: 'product_category_conflict',
      productId: 'product-1',
      currentCategory: 'Electronics',
      candidates: [
        {
          marketplaceKey: 'olx',
          marketplaceId: 'marketplace-1',
          listingId: 'listing-1',
          providerCategoryId: 'projectors-91',
          name: 'Projectors',
          path: ['Electronics', 'TV and video', 'Projectors'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-15T01:00:00.000Z',
        },
        {
          marketplaceKey: 'olx',
          marketplaceId: 'marketplace-1',
          listingId: 'listing-2',
          providerCategoryId: 'headphones-44',
          name: 'Wireless headphones',
          path: ['Electronics', 'Audio equipment', 'Wireless headphones'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-15T01:00:00.000Z',
        },
      ],
    };

    const html = renderToStaticMarkup(<ProposedChangeDiff change={conflict} currency="PLN" />);

    expect(html).toContain('Current category: Electronics');
    expect(html).toContain('Electronics › TV and video › Projectors');
    expect(html).toContain('ID projectors-91');
    expect(html).toContain('Electronics › Audio equipment › Wireless headphones');
    expect(html).toContain('ID headphones-44');
  });
});

describe('HermesEventCard activity presentation', () => {
  const pendingEvent: HermesEvent = {
    id: 'event-1',
    workspaceId: 'workspace-1',
    productId: 'product-1',
    type: 'suggested_lower_price',
    severity: 'warning',
    status: 'pending_review',
    title: 'Review a price change',
    detail: 'A lower price may improve visibility.',
    proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
    createdAt: '2026-07-18T12:00:00.000Z',
  };

  it('renders an accessible typed icon, product context, View link, and supported review actions', () => {
    const html = renderToStaticMarkup(<HermesEventCard event={pendingEvent} />);

    expect(html).toContain('aria-label="Suggested lower price, warning severity"');
    expect(html).toContain('Product context');
    expect(html).toContain('Related MarketDesk product');
    expect(html).toContain('href="/products/product-1"');
    expect(html).toContain('View product');
    expect(html).toContain('Approve');
    expect(html).toContain('Dismiss');
  });

  it('uses distinct icons for different event types', () => {
    const priceIcon = renderToStaticMarkup(
      <HermesEventTypeIcon type="suggested_lower_price" severity="warning" />
    );
    const listingIcon = renderToStaticMarkup(
      <HermesEventTypeIcon type="create_listing" severity="success" />
    );

    expect(priceIcon).toContain('data-testid="TrendingDownIcon"');
    expect(listingIcon).toContain('data-testid="StorefrontOutlinedIcon"');
  });

  it('does not render disabled approval controls for a completed event', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard event={{ ...pendingEvent, status: 'applied' }} />
    );

    expect(html).toContain('>Applied in MarketDesk<');
    expect(html).toContain('View product');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('>Dismiss<');
  });

  it('does not offer unsupported create-listing approval', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard
        event={{
          ...pendingEvent,
          type: 'create_listing',
          proposedChange: { kind: 'create_listing', marketplaceKey: 'olx' },
        }}
      />
    );

    expect(html).not.toContain('>Approve<');
    expect(html).toContain('>Dismiss<');
  });

  it('renders compact SEO review with explicit Git-style before and after labels', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard
        variant="compactReview"
        approveLabel="Apply"
        event={{
          ...pendingEvent,
          type: 'suggested_better_title',
          severity: 'info',
          title: 'Improve listing title',
          proposedChange: {
            kind: 'title',
            field: 'title',
            from: 'Old title',
            to: 'Long improved title with marketplace search intent',
          },
        }}
      />
    );

    expect(html).toContain('data-variant="compact-review"');
    expect(html).toContain('SEO, listing search optimization');
    expect(html).toContain('Title · proposed diff');
    expect(html).toContain('− Before');
    expect(html).toContain('+ After');
    expect(html).toContain('>Apply<');
    expect(html).not.toContain('Product context');
  });

  const chipCount = (html: string) => html.match(/class="[^"]*MuiChip-root/g)?.length ?? 0;

  it('shows one status chip and names a review decision in the caption', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard event={{ ...pendingEvent, autonomyDecision: 'pending_review' }} />,
    );

    expect(html).toContain('Pending review');
    expect(html).not.toContain('Awaiting approval');
    expect(html).toContain('Autonomy decision: review required');
    expect(chipCount(html)).toBe(chipCount(renderToStaticMarkup(<HermesEventCard event={pendingEvent} />)));
  });

  it('names an auto-apply decision in the caption instead of a second status chip', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard event={{ ...pendingEvent, status: 'applied', autonomyDecision: 'auto_apply' }} />,
    );

    expect(html).not.toContain('Auto-applied');
    expect(html).toContain('Autonomy decision: apply without review');
  });

  it('adds no autonomy line when the event records no decision', () => {
    expect(renderToStaticMarkup(<HermesEventCard event={pendingEvent} />)).not.toContain(
      'Autonomy decision',
    );
  });
});

describe('applied event copy', () => {
  it.each([
    ['queued', 'Applied in MarketDesk · marketplace update queued'],
    ['retry_required', 'Applied in MarketDesk · marketplace update needs a retry'],
  ])('words the backend sync state %s in plain language', (sync, copy) => {
    expect(hermesLifecycleCopy('applied', sync)).toBe(copy);
  });

  it.each([
    ['not_required', 'no marketplace update was needed'],
    ['null', 'there is no sync state'],
    ['confirmed', 'the value is not in the vocabulary this UI knows'],
    ['some_new_state', 'the value is not in the vocabulary this UI knows'],
    ['constructor', 'the value only matches an inherited object property'],
  ])('claims nothing about the marketplace when %s: %s', (sync) => {
    const value = sync === 'null' ? null : sync;

    expect(hermesLifecycleCopy('applied', value)).toBe('Applied in MarketDesk');
  });

  it('claims nothing when the event carries no sync state at all', () => {
    expect(hermesLifecycleCopy('applied')).toBe('Applied in MarketDesk');
  });

  it('regression guard: never prints a raw backend token', () => {
    for (const sync of ['queued', 'retry_required', 'not_required', 'confirmed', 'failed', 'x_y']) {
      expect(hermesLifecycleCopy('applied', sync)).not.toMatch(/_/);
    }
  });

  it('keeps the lifecycle copy of every other status independent of marketplace sync', () => {
    expect(hermesLifecycleCopy('pending_review', 'retry_required')).toBe(
      'A recorded decision is required before MarketDesk can continue.',
    );
    expect(hermesLifecycleCopy('dismissed')).toBe(
      'This suggestion was dismissed without applying the proposed change.',
    );
  });
});

type CaptionProps = Parameters<typeof HermesLifecycleCaption>[0];
type CaptionElement = React.ReactElement<{
  sx: (theme: Theme) => { color: string };
  children: string;
}>;
const captionFor = (props: CaptionProps) => HermesLifecycleCaption(props) as CaptionElement;
const captionColor = (props: CaptionProps, theme: Theme) => captionFor(props).props.sx(theme).color;

describe('HermesEventCard provenance and marketplace sync', () => {
  const applied: HermesEventCardProps['event'] = {
    id: 'event-applied',
    workspaceId: 'workspace-1',
    productId: 'product-1',
    type: 'suggested_lower_price',
    severity: 'warning',
    status: 'applied',
    title: 'Lower the price',
    detail: 'Views are up but nothing sold in 7 days.',
    proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
    createdAt: '2026-10-24T08:00:00.000Z',
  };

  it('shows the marketplace update state on an applied card', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard event={{ ...applied, marketplaceSync: 'queued' }} />,
    );

    expect(html).toContain('Applied in MarketDesk · marketplace update queued');
    expect(html).not.toContain('MarketDesk recorded this action as completed.');
  });

  it('shows a retry-required update as needing a retry, never as the raw token', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard event={{ ...applied, marketplaceSync: 'retry_required' }} />,
    );

    expect(html).toContain('Applied in MarketDesk · marketplace update needs a retry');
    expect(html).not.toContain('retry_required');
  });

  it.each(['not_required', null, 'something_new'])(
    'adds nothing about the marketplace for the sync value %s',
    (sync) => {
      const html = renderToStaticMarkup(
        <HermesEventCard event={{ ...applied, marketplaceSync: sync }} />,
      );

      expect(html).toContain('>Applied in MarketDesk<');
      expect(html).not.toContain('marketplace update');
      expect(html).not.toContain('not_required');
    },
  );

  const retry: CaptionProps = { status: 'applied', marketplaceSync: 'retry_required' };

  it('keeps a retry-required update visible as a warning and the rest neutral', () => {
    const neutral: CaptionProps[] = [
      { status: 'applied', marketplaceSync: 'queued' },
      { status: 'applied', marketplaceSync: 'something_new' },
      { status: 'pending_review', marketplaceSync: 'retry_required' },
    ];

    expect(captionFor(retry).props.children).toBe(
      'Applied in MarketDesk · marketplace update needs a retry',
    );
    expect(captionColor(retry, lightTheme)).toBe(lightTheme.palette.warning.dark);
    for (const props of neutral) {
      expect(captionColor(props, lightTheme)).toBe(lightTheme.palette.text.secondary);
      expect(captionColor(props, darkTheme)).toBe(darkTheme.palette.text.secondary);
    }
  });

  it('uses warning.main for a retry-required update in dark mode, where warning.dark lacks contrast', () => {
    expect(captionColor(retry, darkTheme)).toBe(darkTheme.palette.warning.main);
  });

  it('marks suggestions produced by the offline heuristics', () => {
    const html = renderToStaticMarkup(<HermesEventCard event={{ ...applied, source: 'offline' }} />);

    expect(html).toContain('>Heuristic<');
    expect(html).toContain('not by Hermes');
  });

  it.each([
    ['came from Hermes', { source: 'hermes' as const }],
    ['has no recorded source', {}],
  ])('adds no Heuristic chip when the event %s', (_label, extra) => {
    const html = renderToStaticMarkup(<HermesEventCard event={{ ...applied, ...extra }} />);

    expect(html).not.toContain('Heuristic');
  });

  it('marks offline suggestions in the compact review card too', () => {
    const html = renderToStaticMarkup(
      <HermesEventCard
        variant="compactReview"
        event={{ ...applied, status: 'pending_review', source: 'offline' }}
      />,
    );

    expect(html).toContain('>Heuristic<');
  });
});
