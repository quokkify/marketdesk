import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Button, Switch } from '@mui/material';
import type { Marketplace } from '@shared/types';
import { MarketplaceCard, SYNC_ISSUES_PATH } from './MarketplaceCard';
import type { MarketplaceCardProps } from './MarketplaceCard';
import { ROADMAP_CARD_COPY, RoadmapMarketplaceCard } from './RoadmapMarketplaceCard';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    sandbox: false,
    syncMode: 'manual',
    lastSyncAt: undefined,
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function cardProps(
  overrides: Partial<Marketplace> = {},
  props: Partial<MarketplaceCardProps> = {},
): MarketplaceCardProps {
  return {
    marketplace: marketplace(overrides),
    connected: overrides.connected ?? true,
    liveListingCount: 12,
    syncing: false,
    busy: false,
    credentialsMissing: false,
    onConnect: jest.fn(),
    onRequestDisconnect: jest.fn(),
    onConfigure: jest.fn(),
    onImportPreview: jest.fn(),
    ...props,
  };
}

function renderHtml(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}

function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (React.isValidElement(node)) return textContent((node as ElementLike).props.children);
  return '';
}

describe('MarketplaceCard', () => {
  it('shows the connection status and the listing, sync, error and last-sync rows', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps()} />);

    expect(html).toContain('aria-label="OLX logo"');
    expect(html).toContain('>Connected</');
    expect(html).not.toContain('>Sandbox</');
    for (const label of ['Listings', 'Synchronization', 'Errors', 'Last sync']) {
      expect(html).toContain(`>${label}</dt>`);
    }
    expect(html).toContain('>12 live</dd>');
    expect(html).toContain('>Manual</dd>');
    expect(html).toContain('>No errors</dd>');
    expect(html).toContain('>Never</dd>');
  });

  it('shows an unknown live count as a dash instead of zero', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps({}, { liveListingCount: null })} />);

    expect(html).toContain('>—</dd>');
    expect(html).not.toContain('0 live');
  });

  it('offers Connect with OLX when disconnected', () => {
    const props = cardProps({ connected: false });
    const html = renderHtml(<MarketplaceCard {...props} />);
    const connect = findByType(MarketplaceCard(props) as ElementLike, Button).find(
      (button) => textContent(button) === 'Connect with OLX',
    );

    expect(html).toContain('>Disconnected</');
    expect(html).toContain('Connect with OLX');
    expect(html).toContain('Configure');
    (connect?.props.onClick as () => void)();
    expect(props.onConnect).toHaveBeenCalledWith(props.marketplace);
  });

  it('labels sandbox mode on the status line and the connect button', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps({ connected: false, sandbox: true })} />);

    expect(html).toContain('>Sandbox</span>');
    expect(html).toContain('Connect sandbox OLX');
    expect(html).not.toContain('Connect with OLX');
  });

  it('trusts the connected prop over the list view flag', () => {
    const html = renderHtml(
      <MarketplaceCard {...cardProps({ connected: true }, { connected: false })} />,
    );

    expect(html).toContain('>Disconnected</');
    expect(html).toContain('Connect with OLX');
  });

  it('turning the switch off requests a disconnect and turning it on starts connecting', () => {
    const connected = cardProps();
    const disconnected = cardProps({ connected: false });
    const [onSwitch] = findByType(MarketplaceCard(connected) as ElementLike, Switch);
    const [offSwitch] = findByType(MarketplaceCard(disconnected) as ElementLike, Switch);
    const change = {} as React.ChangeEvent<HTMLInputElement>;

    expect(onSwitch?.props.checked).toBe(true);
    expect(onSwitch?.props.slotProps).toEqual({ input: { 'aria-label': 'OLX connection' } });
    (onSwitch?.props.onChange as (event: unknown, checked: boolean) => void)(change, false);
    expect(connected.onRequestDisconnect).toHaveBeenCalledWith(connected.marketplace);
    expect(connected.onConnect).not.toHaveBeenCalled();

    expect(offSwitch?.props.checked).toBe(false);
    (offSwitch?.props.onChange as (event: unknown, checked: boolean) => void)(change, true);
    expect(disconnected.onConnect).toHaveBeenCalledWith(disconnected.marketplace);
  });

  it('locks the switch while a connection change or sync is in flight', () => {
    const [busySwitch] = findByType(MarketplaceCard(cardProps({}, { busy: true })) as ElementLike, Switch);
    const [syncSwitch] = findByType(MarketplaceCard(cardProps({}, { syncing: true })) as ElementLike, Switch);

    expect(busySwitch?.props.disabled).toBe(true);
    expect(syncSwitch?.props.disabled).toBe(true);
  });

  it('shows Syncing… on the status line while a sync runs', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps({}, { syncing: true })} />);

    expect(html).toContain('>Syncing…</');
  });

  it('counts sync errors and links them to the listings error filter', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps({ errorCount: 2 })} />);

    expect(SYNC_ISSUES_PATH).toBe('/listings?status=error');
    expect(html).toContain('>2 errors</dd>');
    expect(html).toContain('href="/listings?status=error"');
    expect(html).toContain('Review sync issues');
  });

  it('hides the sync-issues link when there are no errors', () => {
    const html = renderHtml(<MarketplaceCard {...cardProps({ errorCount: 0 })} />);

    expect(html).not.toContain('Review sync issues');
  });

  it('offers Preview import only for a connected marketplace outside sandbox mode', () => {
    const real = cardProps();
    const preview = findByType(MarketplaceCard(real) as ElementLike, Button).find(
      (button) => textContent(button) === 'Preview import',
    );

    (preview?.props.onClick as () => void)();
    expect(real.onImportPreview).toHaveBeenCalledWith(real.marketplace);
    expect(renderHtml(<MarketplaceCard {...cardProps({ sandbox: true })} />)).not.toContain('Preview import');
    expect(renderHtml(<MarketplaceCard {...cardProps({ connected: false })} />)).not.toContain('Preview import');
  });

  it('opens configuration from the Configure button', () => {
    const props = cardProps();
    const configure = findByType(MarketplaceCard(props) as ElementLike, Button).find(
      (button) => textContent(button) === 'Configure',
    );

    (configure?.props.onClick as () => void)();
    expect(props.onConfigure).toHaveBeenCalledWith(props.marketplace);
  });

  it('asks for app credentials before connecting when they are missing', () => {
    const html = renderHtml(
      <MarketplaceCard {...cardProps({ connected: false }, { credentialsMissing: true })} />,
    );

    expect(html).toContain('Add your OLX app credentials in Configure before connecting.');
  });
});

describe('RoadmapMarketplaceCard', () => {
  it('shows a muted roadmap card with a disabled switch and no actions', () => {
    const tree = RoadmapMarketplaceCard({ marketplaceKey: 'allegro' }) as ElementLike;
    const [toggle] = findByType(tree, Switch);
    const html = renderHtml(<RoadmapMarketplaceCard marketplaceKey="allegro" />);

    expect(ROADMAP_CARD_COPY).toBe('Roadmap channel. MarketDesk currently integrates OLX only.');
    expect(html).toContain('aria-label="Allegro logo"');
    expect(html).toContain('>Allegro</h2>');
    expect(html).toContain('>Not available yet</span>');
    expect(html).toContain(ROADMAP_CARD_COPY);
    expect(toggle?.props.checked).toBe(false);
    expect(toggle?.props.disabled).toBe(true);
    expect(findByType(tree, Button)).toHaveLength(0);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Connect');
  });
});
