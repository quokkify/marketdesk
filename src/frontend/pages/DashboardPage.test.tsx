import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Marketplace } from '@shared/types';
import { Badge } from '../components/common/Badge';
import type { AttentionItem } from './dashboardPresentation';
import { AttentionRow, MarketplaceRow, QuickActionTile } from './DashboardPage';

const noop = () => undefined;

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function findElements(node: React.ReactNode, match: (element: ElementLike) => boolean): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, match));
  if (!React.isValidElement(node)) return [];
  const element = node as ElementLike;
  return [...(match(element) ? [element] : []), ...findElements(element.props.children, match)];
}

function marketplace(overrides: Partial<Marketplace & { sandbox: boolean }> = {}): Marketplace {
  return {
    id: 'marketplace-1',
    workspaceId: 'workspace-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'manual',
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: 'listing:l1',
    title: 'Road bike frame',
    reason: 'Listing expired',
    severity: 'warning',
    path: '/products/p1',
    ...overrides,
  };
}

describe('dashboard marketplace overview row', () => {
  it('labels a sandbox marketplace as Sandbox next to its name', () => {
    const html = renderToStaticMarkup(
      <MarketplaceRow marketplace={marketplace({ sandbox: true })} onOpen={noop} />
    );

    expect(html).toContain('>Sandbox<');
    expect(html).toContain('>OLX<');
    expect(html).toContain('>Connected<');
  });

  it('gives the Sandbox badge the warning tone every other sandbox label uses', () => {
    const row = MarketplaceRow({ marketplace: marketplace({ sandbox: true }), onOpen: noop }) as ElementLike;
    const sandboxBadges = findElements(
      row,
      (element) => element.type === Badge && element.props.label === 'Sandbox',
    );

    expect(sandboxBadges).toHaveLength(1);
    expect(sandboxBadges[0]!.props.color).toBe('warning');
  });

  it('never claims sandbox mode for a real marketplace', () => {
    const html = renderToStaticMarkup(
      <MarketplaceRow marketplace={marketplace({ sandbox: false })} onOpen={noop} />
    );

    expect(html).not.toContain('Sandbox');
    expect(html).toContain('>Connected<');
  });

  it('states a disconnected marketplace as not connected', () => {
    const html = renderToStaticMarkup(
      <MarketplaceRow marketplace={marketplace({ connected: false })} onOpen={noop} />
    );

    expect(html).toContain('>Not connected<');
    expect(html).not.toContain('>Connected<');
  });
});

describe('dashboard quick action tile', () => {
  it('explains why Sync all is disabled instead of leaving a dead button', () => {
    const html = renderToStaticMarkup(
      <QuickActionTile
        label="Sync all"
        icon={null}
        onClick={noop}
        disabled
        hint="Connect a marketplace first"
      />
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Connect a marketplace first');
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
  });

  it('is enabled and undescribed when it has no hint', () => {
    const html = renderToStaticMarkup(
      <QuickActionTile label="View analytics" icon={null} onClick={noop} />
    );

    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-describedby');
  });

  it('flags a running sync as busy', () => {
    const html = renderToStaticMarkup(
      <QuickActionTile label="Syncing…" icon={null} onClick={noop} disabled busy />
    );

    expect(html).toContain('aria-busy="true"');
  });
});

describe('dashboard needs-attention row', () => {
  it('pairs a critical item with a text label, not only a red dot', () => {
    const html = renderToStaticMarkup(
      <AttentionRow item={attentionItem({ severity: 'critical' })} onOpen={noop} />
    );

    expect(html).toContain('>Critical<');
    expect(html).toContain('Listing expired');
  });

  it('shows a warning item without a severity badge', () => {
    const html = renderToStaticMarkup(<AttentionRow item={attentionItem()} onOpen={noop} />);

    expect(html).not.toContain('>Critical<');
    expect(html).toContain('Road bike frame');
  });
});
