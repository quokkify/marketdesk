import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PriceComparable, PriceResearchView, ResearchRun } from '@shared/types';
import { lightTheme } from '../../../theme/lightTheme';
import { EMPTY_MESSAGE, PricesTab, STALE_ESTIMATE_MESSAGE } from './PricesTab';

const NOW = new Date('2026-11-22T12:00:00.000Z');

const auto = (price: number, tier: PriceComparable['tier'], note: string, url?: string): PriceComparable => ({
  price, note, tier, source: 'auto', seenAt: '2026-11-21', ...(url ? { url } : {}),
});

const view: PriceResearchView = {
  productId: 'p-1',
  retailPrice: 649,
  retailCurrency: 'PLN',
  retailSource: 'manual',
  retailCheckedAt: '2026-11-18',
  comparables: [
    auto(290, 'substitute_new', 'Projector shop', 'https://shop.example/p1'),
    auto(160, 'substitute_used', 'Used LED projector'),
    { price: 180, note: '', source: 'manual', tier: 'same_model_used', seenAt: '2026-11-19' },
  ],
  specs: 'Native 720p, 200 ANSI lumens',
  dismissedUrls: [],
  lastAttemptAt: null,
  lastEstimate: {
    estimate: {
      startPrice: 169,
      floorPrice: 155,
      retailAnchor: { amount: 649, basis: 'estimated' },
      usedRange: { low: 150, high: 170, basis: 'estimated' },
      reasoning: 'x',
      confidence: 'medium',
    },
    estimatedAt: '2026-11-22T10:00:00.000Z',
    hiddenReason: null,
    researchNote: null,
    researchUpdatedAt: '2026-11-21T10:00:00.000Z',
  },
  updatedAt: '2026-11-21T10:00:00.000Z',
  run: null,
  lastRun: null,
  nextAutoAt: null,
  readiness: 'ready',
};

const emptyView: PriceResearchView = {
  ...view, retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
  comparables: [], specs: null, lastEstimate: null, updatedAt: null,
};

const activeRun = { id: 'r1', status: 'running', nodes: { identify: 'done', sameModelUsed: 'done' } } as unknown as ResearchRun;

function render(props: Partial<React.ComponentProps<typeof PricesTab>> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <PricesTab
        view={view}
        onRetry={() => undefined}
        currency="PLN"
        listingCurrency="PLN"
        now={NOW}
        searching={false}
        searchMessage={null}
        onSearchAgain={() => undefined}
        onAnalyze={() => undefined}
        analyzing={false}
        analyzeDisabledReason={null}
        onSave={async () => undefined}
        onReload={() => undefined}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('PricesTab', () => {
  it('shows the four figures, the sentence, the found rows by tier and the yours rows', () => {
    const html = render();
    expect(html).toContain('data-testid="prices-summary"');
    for (const text of ['169 zł', '155 zł', '649 zł', '150–170 zł', '74% below the new price · confidence: medium']) {
      expect(html).toContain(text);
    }
    const tiers = [...html.matchAll(/data-testid="found-tier-(\w+)"/g)].map((m) => m[1]);
    expect(tiers).toEqual(['same_model_used', 'last_new_price', 'substitute_new', 'substitute_used']);
    expect(html).toContain('none found');
    expect(html).toContain('Projector shop');
    expect(html).toContain('href="https://shop.example/p1"');
    expect(html).toContain('290 zł');
    expect(html).toContain('How Hermes matched substitutes');
    // The manual row and the retail value are the seller's, not Hermes'.
    const found = html.slice(html.indexOf('prices-found-list'), html.indexOf('my-prices-list'));
    expect(found).not.toContain('180 zł');
    const mine = html.slice(html.indexOf('my-prices-list'), html.indexOf('my-price-form'));
    expect(mine.match(/yours/g)).toHaveLength(2);
    expect(mine).toContain('data-testid="my-price-remove-retail"');
    expect(mine).toContain('data-testid="my-price-remove-2"');
    expect(html).not.toContain('my-price-error');
  });

  it('shows one empty state with Analyze product, then the form', () => {
    const html = render({ view: emptyView });
    expect(html).toContain(EMPTY_MESSAGE);
    expect(html).toContain('Analyze product');
    expect(html).not.toContain('prices-found-list');
    expect(html).not.toContain('my-prices-list');
    expect(html).toContain('data-testid="my-price-form"');
  });

  it('disables the form and says why at the 30 prices limit', () => {
    const rows = Array.from({ length: 30 }, (_, i) => auto(100 + i, 'same_model_used', 'row'));
    const html = render({ view: { ...view, comparables: rows } });
    expect(html).toContain('30 prices is the limit. Remove one to add another.');
    expect(html).toMatch(/data-testid="my-price-add"[^>]*disabled|disabled[^>]*data-testid="my-price-add"/);
    expect(html).toMatch(/<input[^>]*disabled[^>]*data-testid="my-price-price"|<input[^>]*data-testid="my-price-price"[^>]*disabled/);
  });

  it('disables Search again with the reason for a listing that is not in PLN, and keeps the add form enabled', () => {
    const html = render({ listingCurrency: 'EUR' });
    expect(html).toContain('OLX search needs a PLN listing');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="prices-search-again"|<button[^>]*data-testid="prices-search-again"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*data-testid="my-price-add"/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*data-testid="my-price-add"|<button[^>]*data-testid="my-price-add"[^>]*disabled/);
    expect(html).not.toMatch(/<input[^>]*disabled[^>]*data-testid="my-price-price"|<input[^>]*data-testid="my-price-price"[^>]*disabled/);
  });

  it('the empty-state Analyze product is disabled while an analysis starts or runs, and says why it is off', () => {
    const disabled = /<button[^>]*disabled[^>]*data-testid="prices-analyze"|<button[^>]*data-testid="prices-analyze"[^>]*disabled/;
    expect(render({ view: emptyView })).toMatch(/data-testid="prices-analyze"/);
    expect(render({ view: emptyView })).not.toMatch(disabled);
    expect(render({ view: emptyView, analyzing: true })).toMatch(disabled);
    const off = render({ view: emptyView, analyzeDisabledReason: 'The listing SEO agent is switched off for this workspace.' });
    expect(off).toMatch(disabled);
    expect(off).toContain('The listing SEO agent is switched off for this workspace.');
  });

  it('keeps Search again enabled for a PLN listing and says Searching… with progress while a run is active', () => {
    expect(render()).not.toMatch(/<button[^>]*disabled[^>]*data-testid="prices-search-again"/);
    const html = render({ view: { ...view, run: activeRun } });
    expect(html).toContain('Searching…');
    expect(html).toContain('Searching prices: 1 of 4');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="prices-search-again"|<button[^>]*data-testid="prices-search-again"[^>]*disabled/);
  });

  it('shows the server message of a refused search next to the button', () => {
    expect(render({ searchMessage: 'A price search is already running.' })).toContain('A price search is already running.');
  });

  it('shows a skeleton while loading and a retry on error', () => {
    expect(render({ view: undefined })).not.toContain('my-price-form');
    expect(render({ view: undefined, error: { status: 500 } })).toContain('Try again');
  });

  it('says why an estimate is not suggested, only when it is not', () => {
    expect(render()).not.toContain('prices-hidden-reason');
    const hidden = { ...view.lastEstimate!, hiddenReason: 'low_confidence' as const };
    const html = render({ view: { ...view, lastEstimate: hidden } });
    expect(html).toContain('Not suggested: confidence is low.');
  });

  it('shows the research note of the estimate, only when there is one', () => {
    expect(render()).not.toContain('prices-research-note');
    const noted = { ...view.lastEstimate!, researchNote: 'Nothing found for this model' };
    expect(render({ view: { ...view, lastEstimate: noted } })).toContain('Nothing found for this model');
  });

  it('says the estimate predates the research, only when it does', () => {
    expect(render()).not.toContain('prices-estimate-stale');
    const stale = { ...view.lastEstimate!, researchUpdatedAt: '2026-11-20T10:00:00.000Z' };
    expect(render({ view: { ...view, lastEstimate: stale } })).toContain(STALE_ESTIMATE_MESSAGE);
  });
});
