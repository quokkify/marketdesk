import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@mui/material';
import { MarketplaceSummaryBar } from './MarketplaceSummaryBar';
import type { MarketplaceSummaryBarProps } from './MarketplaceSummaryBar';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

const NOW = new Date('2026-10-24T12:00:00.000Z');

function summaryProps(overrides: Partial<MarketplaceSummaryBarProps> = {}): MarketplaceSummaryBarProps {
  return {
    connectedCount: 1,
    totalCount: 7,
    liveListingCount: 12,
    lastFullSyncAt: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString(),
    sandbox: false,
    syncing: false,
    onSyncAll: jest.fn(),
    ...overrides,
  };
}

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}

function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

function syncAllButton(props: MarketplaceSummaryBarProps): ElementLike | undefined {
  return findByType(MarketplaceSummaryBar(props) as ElementLike, Button)[0];
}

describe('MarketplaceSummaryBar', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('summarises connections, active listings and the last full sync', () => {
    const html = renderToStaticMarkup(<MarketplaceSummaryBar {...summaryProps()} />);

    expect(html).toContain('>1 of 7 marketplaces connected</');
    expect(html).toContain('>12 active listings · last full sync 2 minutes ago</');
    expect(html).toContain('Sync all');
  });

  it('says so when no full sync has happened yet', () => {
    const html = renderToStaticMarkup(
      <MarketplaceSummaryBar {...summaryProps({ lastFullSyncAt: undefined })} />,
    );

    expect(html).toContain('>12 active listings · no full sync yet</');
  });

  it('labels sandbox mode next to the connection count', () => {
    const sandboxHtml = renderToStaticMarkup(<MarketplaceSummaryBar {...summaryProps({ sandbox: true })} />);
    const realHtml = renderToStaticMarkup(<MarketplaceSummaryBar {...summaryProps()} />);

    expect(sandboxHtml).toContain('>Sandbox</span>');
    expect(realHtml).not.toContain('>Sandbox</span>');
  });

  it('leaves out the listing count while it is unknown', () => {
    const html = renderToStaticMarkup(
      <MarketplaceSummaryBar {...summaryProps({ liveListingCount: null })} />,
    );

    expect(html).not.toContain('active listings');
    expect(html).toContain('>last full sync 2 minutes ago</');
  });

  it('runs Sync all only when a marketplace is connected and no sync is running', () => {
    const ready = summaryProps();
    const button = syncAllButton(ready);

    expect(button?.props.disabled).toBe(false);
    (button?.props.onClick as () => void)();
    expect(ready.onSyncAll).toHaveBeenCalledTimes(1);
    expect(syncAllButton(summaryProps({ connectedCount: 0 }))?.props.disabled).toBe(true);
    expect(syncAllButton(summaryProps({ syncing: true }))?.props.disabled).toBe(true);
    expect(renderToStaticMarkup(<MarketplaceSummaryBar {...summaryProps({ syncing: true })} />)).toContain(
      'Syncing…',
    );
  });
});
