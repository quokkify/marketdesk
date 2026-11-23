import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, Typography } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import type { Product, ProductStats } from '@shared/types';
import {
  CatalogueFooter,
  ProductRowActions,
  ProductsCards,
  PRODUCT_TABLE_COLUMNS,
  ProductsTable,
  productRowMenuItems,
  rowClickIntent,
} from './ProductsTable';
import { withoutStyleTags } from '../../testkit/staticMarkup';

const markup = (node: React.ReactElement) =>
  withoutStyleTags(renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>));

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(
    React.isValidElement
  ) as ElementLike[];
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

const product: Product = {
  id: 'p-1',
  workspaceId: 'w-1',
  sku: 'SKU-100',
  name: 'Wireless Headphones',
  description: 'Description',
  costPrice: 100,
  sellingPrice: 250,
  condition: 'new',
  category: 'Audio',
  status: 'active',
  tags: ['audio', 'featured'],
  images: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('ProductsTable catalogue hierarchy', () => {
  it('renders product identity, fallback initials and price', () => {
    const html = markup(
      <ProductsTable products={[product]} currency="PLN" selectedIds={new Set(['p-1'])} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('SKU-100');
    expect(html).toContain('WH');
    expect(html).toContain('250 zł');
    expect(html).toContain('Select all products on this page');
  });

  it('renders only the stage 1 columns', () => {
    expect(PRODUCT_TABLE_COLUMNS.map((column) => column.key)).toEqual([
      'select',
      'product',
      'status',
      'price',
      'views',
      'ai',
      'actions',
    ]);
    const html = markup(<ProductsTable products={[product]} currency="PLN" />);
    for (const gone of [
      'Markets',
      'Cost',
      'Profit',
      'Tags',
      'featured',
      'margin',
      'Marketplace count unavailable',
    ]) {
      expect(html).not.toContain(gone);
    }
  });

  it('draws a seven-cell skeleton row while loading', () => {
    const html = markup(<ProductsTable products={[]} loading />);
    const firstRow = html.split('<tr').find((row) => row.includes('MuiSkeleton')) ?? '';
    expect(firstRow.match(/<td/g)).toHaveLength(7);
  });

  it('shows the short listing id with the full SKU as its title', () => {
    const imported = { ...product, sku: 'OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120' };
    const html = markup(<ProductsTable products={[imported]} />);
    expect(html).toContain('OLX · 1085784120');
    expect(html).toContain('title="OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120"');
  });

  // Regression guard: a middle-click on the title is handled by the link alone, never also by the row.
  it('excludes the title link from row opening', () => {
    const html = markup(<ProductsTable products={[product]} onOpen={() => {}} />);
    expect(html).toMatch(
      /<a[^>]*href="\/products\/p-1"[^>]*data-row-stop|<a[^>]*data-row-stop[^>]*href="\/products\/p-1"/
    );
  });

  it('links the product title to its page', () => {
    const html = markup(<ProductsTable products={[product]} onOpen={() => {}} />);
    expect(html).toContain('href="/products/p-1"');
  });

  it.each([
    [{ metaKey: false, ctrlKey: false, button: 0, insideStop: false, insideRow: true }, 'open'],
    [{ metaKey: true, ctrlKey: false, button: 0, insideStop: false, insideRow: true }, 'new-tab'],
    [{ metaKey: false, ctrlKey: true, button: 0, insideStop: false, insideRow: true }, 'new-tab'],
    [{ metaKey: false, ctrlKey: false, button: 1, insideStop: false, insideRow: true }, 'new-tab'],
    [{ metaKey: false, ctrlKey: false, button: 0, insideStop: true, insideRow: true }, 'ignore'],
    [{ metaKey: true, ctrlKey: false, button: 0, insideStop: true, insideRow: true }, 'ignore'],
    // Regression guard: clicks in the portaled row menu bubble to the row through React.
    [{ metaKey: false, ctrlKey: false, button: 0, insideStop: false, insideRow: false }, 'ignore'],
    // Regression guard: right-click (auxclick with button 2) must not open the product.
    [{ metaKey: false, ctrlKey: false, button: 2, insideStop: false, insideRow: true }, 'ignore'],
  ] as const)('row click %o opens as %s', (event, intent) => {
    expect(rowClickIntent(event)).toBe(intent);
  });

  it('formats money in PLN style; cards still show when each product was last updated', () => {
    const updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const items = [{ ...product, costPrice: 800, sellingPrice: 1050, updatedAt }];
    const html = markup(<ProductsTable products={items} currency="PLN" />);
    expect(html).toContain('1 050 zł');
    expect(html).not.toContain('800 zł');
    expect(markup(<ProductsCards products={items} currency="PLN" />)).toContain('2h ago');
  });

  it('offers a row actions menu instead of navigating from the overflow control', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        currency="PLN"
        onOpen={() => undefined}
        onEdit={() => undefined}
      />
    );
    expect(html).toContain('aria-label="Actions for Wireless Headphones"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('distinguishes an empty catalogue from an empty filtered result', () => {
    const empty = markup(<ProductsTable products={[]} />);
    const filtered = markup(
      <ProductsTable
        products={[]}
        emptyFiltered
        clearFiltersAction={<button>Clear filters</button>}
      />
    );
    expect(empty).toContain('Your catalogue is empty');
    expect(empty).not.toContain('No products match');
    expect(filtered).toContain('No products match');
    expect(filtered).toContain('Clear filters');
  });

  it('keeps price, updated date and the actions menu in card view without cost, profit, markets or tags', () => {
    const html = markup(
      <ProductsCards products={[product]} currency="PLN" onEdit={() => undefined} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('250 zł');
    expect(html).toContain('Updated');
    expect(html).toContain('aria-label="Actions for Wireless Headphones"');
    for (const gone of ['Cost', 'Profit', 'Markets', 'featured', 'margin']) {
      expect(html).not.toContain(gone);
    }
  });
});

describe('views, reasons and the listing link', () => {
  const stats = (over: Partial<ProductStats> = {}): ProductStats => ({
    views: 10,
    watchers: 3,
    messages: 1,
    viewsDelta7d: 2,
    viewsByDay: [0, 1, 2, 3, 1, 0, 2, 4, 1, 0, 0, 3, 2, 1],
    lastSyncAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    stale: false,
    externalUrl: null,
    listingStatus: 'live',
    needsAction: [],
    response: null,
    ...over,
  });
  const other = { ...product, id: 'p-2', name: 'Other' };

  it('shows views, growth, trend and freshness', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        statsByProductId={{ 'p-1': stats({ views: 128, viewsDelta7d: 14 }) }}
      />
    );
    expect(html).toContain('Views · 7 days');
    expect(html).toContain('128');
    expect(html).toContain('▲ +14');
    expect(html).toContain('<polyline');
    expect(html).toContain('watching');
    expect(html).not.toContain('>Updated<');
  });

  it('shows stale without a trend and a dash without stats', () => {
    const html = markup(
      <ProductsTable
        products={[product, other]}
        statsByProductId={{ 'p-1': stats({ views: 203, viewsDelta7d: null, stale: true }) }}
      />
    );
    expect(html).toContain('stale');
    expect(html).not.toContain('<polyline');
    expect(html).toContain('—');
  });

  it('lists needs-action reasons and the condition hint under the status', () => {
    const html = markup(
      <ProductsTable
        products={[{ ...product, condition: 'unknown' }]}
        statsByProductId={{ 'p-1': stats({ needsAction: ['buyer_waiting', 'no_view_growth'] }) }}
      />
    );
    expect(html).toContain('Buyer waiting');
    expect(html).toContain('No view growth for 7 days');
    expect(html).toContain('Condition not confirmed');
  });

  it('links the short listing id to the OLX advert in a new tab', () => {
    const imported = { ...product, sku: 'OLX-5e881fca-2811-4a73-aaaf-da9b23f485a1-1085784120' };
    const html = markup(
      <ProductsTable
        products={[imported]}
        statsByProductId={{ 'p-1': stats({ externalUrl: 'https://www.olx.pl/d/oferta/x.html' }) }}
      />
    );
    expect(html).toContain('href="https://www.olx.pl/d/oferta/x.html"');
    expect(html).toContain('target="_blank"');
  });

  const signal = (over: Partial<NonNullable<ProductStats['response']>> = {}): NonNullable<ProductStats['response']> => ({
    listingId: 'l-1',
    stage: 'not_seen',
    views: 4,
    viewsPerDay: 1,
    hoursLive: 80,
    viewsNeeded: null,
    ...over,
  });

  it('shows the response stage and the Why no response? button for a listing nobody sees', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAskWhy={() => undefined}
        statsByProductId={{ 'p-1': stats({ response: signal() }) }}
      />
    );
    expect(html).toContain('Not seen · day 4');
    expect(html).toContain('Why no response?');
  });

  it('shows neither the stage nor the button for a responding listing', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAskWhy={() => undefined}
        statsByProductId={{ 'p-1': stats({ response: signal({ stage: 'responding' }) }) }}
      />
    );
    expect(html).not.toContain('Not seen');
    expect(html).not.toContain('Why no response?');
  });

  it('shows Checking… instead of the button while a run is active', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAskWhy={() => undefined}
        responseByProductId={{ 'p-1': { active: true, outOfDate: false, latest: null } }}
        statsByProductId={{ 'p-1': stats({ response: signal() }) }}
      />
    );
    expect(html).toContain('Checking…');
    expect(html).not.toContain('Why no response?');
  });

  const responseRun = (over: Partial<NonNullable<Product['response']>> = {}) =>
    ({
      id: 'r-1',
      listingId: 'l-1',
      completedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      findings: ['first', 'second', 'third'].map((message) => ({ code: 'crowded_market', message, action: null, evidence: {} })),
      ...over,
    }) as unknown as NonNullable<Product['response']>;

  it('shows when the run was made, its first two findings and the out of date mark of the list item', () => {
    const html = markup(
      <ProductsTable
        products={[{ ...product, response: responseRun(), responseOutOfDate: true }]}
        statsByProductId={{ 'p-1': stats({ response: signal() }) }}
      />
    );
    expect(html).toContain('checked 3h ago');
    expect(html).toContain('first');
    expect(html).toContain('second');
    expect(html).not.toContain('third');
    expect(html).toContain('out of date');
  });

  it('takes the out of date mark from the list item once it carries the pressed run', () => {
    const run = responseRun();
    const html = markup(
      <ProductsTable
        products={[{ ...product, response: run, responseOutOfDate: true }]}
        responseByProductId={{ 'p-1': { active: false, outOfDate: false, latest: run } }}
        statsByProductId={{ 'p-1': stats({ response: signal() }) }}
      />
    );
    expect(html).toContain('out of date');
  });

  it('shows no findings made for another listing than the live one', () => {
    const html = markup(
      <ProductsTable
        products={[{ ...product, response: responseRun({ listingId: 'l-old' }) }]}
        statsByProductId={{ 'p-1': stats({ response: signal({ stage: 'too_early', hoursLive: 10 }) }) }}
      />
    );
    expect(html).toContain('Too early');
    expect(html).not.toContain('first');
    expect(html).not.toContain('checked 3h ago');
  });

  it('shows no findings without a live listing', () => {
    const html = markup(
      <ProductsTable
        products={[{ ...product, response: responseRun() }]}
        statsByProductId={{ 'p-1': stats({ response: null }) }}
      />
    );
    expect(html).not.toContain('first');
  });

  it('labels the AI column for screen readers only', () => {
    const html = markup(<ProductsTable products={[product]} />);
    expect(html).not.toMatch(/<th[^>]*>AI<\/th>/);
    expect(html).toContain('AI analysis');
  });
});

describe('row analysis in the table', () => {
  it('renders the analyze button and a review toggle for pending suggestions', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAnalyze={() => {}}
        onToggleReview={() => {}}
        analysisByProductId={{ 'p-1': { status: 'done', count: 2 } }}
      />
    );
    expect(html).toContain('aria-label="Analyze with AI: Wireless Headphones"');
    expect(html).toContain('2 to review');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/products/p-1#');
  });

  it('places the review content in a full-width row under the expanded product only', () => {
    const other = { ...product, id: 'p-2', name: 'Other' };
    const html = markup(
      <ProductsTable
        products={[product, other]}
        onToggleReview={() => {}}
        analysisByProductId={{ 'p-1': { status: 'done', count: 1 } }}
        expandedProductId="p-1"
        renderReview={(p) => <span>review-of-{p.id}</span>}
      />
    );
    expect(html).toContain('review-of-p-1');
    expect(html).not.toContain('review-of-p-2');
    expect(html).toContain('colSpan="7"');
    expect(html).toContain('aria-expanded="true"');
    expect(html.indexOf('review-of-p-1')).toBeLessThan(html.indexOf('Other'));
  });

  it('disables the analyze button while running', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAnalyze={() => {}}
        analysisByProductId={{ 'p-1': { status: 'running' } }}
      />
    );
    const button =
      html.match(/<button[^>]*aria-label="Analyze with AI: Wireless Headphones"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('disabled');
  });

  it('shows why analysis is unavailable', () => {
    const html = markup(
      <ProductsTable
        products={[product]}
        onAnalyze={() => {}}
        analyzeDisabledReason="The listing SEO agent is switched off for this workspace."
      />
    );
    expect(html).toContain('The listing SEO agent is switched off for this workspace.');
  });

  it('disables the menu analyze item when told to', () => {
    const items = productRowMenuItems(
      product,
      { onAnalyze: () => {}, analyzeDisabled: true },
      () => {}
    ) as ElementLike[];
    expect(items[0]!.props.disabled).toBe(true);
  });

  // Regression guard: the kebab item must not start a second run on a row that is already running.
  it('disables the analyze controls of a running row in the menu too', () => {
    const table = ProductsTable({
      products: [product],
      onAnalyze: jest.fn(),
      analysisByProductId: { 'p-1': { status: 'running' } },
    }) as ElementLike;
    const actions = findByType(table, ProductRowActions)[0]!;
    expect((actions.props.handlers as { analyzeDisabled?: boolean }).analyzeDisabled).toBe(true);
  });

  it('puts Analyze with AI first in the row menu when available', () => {
    const items = productRowMenuItems(
      product,
      { onAnalyze: () => {}, onOpen: () => {} },
      () => {}
    ) as ElementLike[];
    expect(textContent(items[0])).toContain('Analyze with AI');
  });
});

describe('product row actions menu', () => {
  it('lists Open, Edit and Delete and routes each to its handler before closing the menu', () => {
    const onOpen = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const close = jest.fn();
    const items = productRowMenuItems(
      product,
      { onOpen, onEdit, onDelete },
      close
    ) as ElementLike[];

    expect(items.map((item) => textContent(item))).toEqual(['Open', 'Edit', 'Delete']);
    (items[0]!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledWith(product);
    (items[1]!.props.onClick as () => void)();
    expect(onEdit).toHaveBeenCalledWith(product);
    (items[2]!.props.onClick as () => void)();
    expect(onDelete).toHaveBeenCalledWith(product);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('gives every table row and card the delete handler', () => {
    const onDelete = jest.fn();
    const table = ProductsTable({
      products: [product],
      onOpen: jest.fn(),
      onDelete,
    }) as ElementLike;
    const cards = ProductsCards({
      products: [product],
      onOpen: jest.fn(),
      onDelete,
    }) as ElementLike;
    const rowActions = [
      ...findByType(table, ProductRowActions),
      ...findByType(cards, ProductRowActions),
    ];

    expect(rowActions).toHaveLength(2);
    expect(
      rowActions.map((actions) => (actions.props.handlers as { onDelete?: unknown }).onDelete)
    ).toEqual([onDelete, onDelete]);
  });

  it('omits actions that have no handler', () => {
    const items = productRowMenuItems(product, { onOpen: jest.fn() }, jest.fn()) as ElementLike[];
    expect(items.map((item) => textContent(item))).toEqual(['Open']);
  });
});

describe('CatalogueFooter', () => {
  it('shows the visible range and maps numbered pages to the zero-based catalogue page', () => {
    const onPageChange = jest.fn();
    const tree = CatalogueFooter({ total: 60, page: 1, pageSize: 25, onPageChange }) as ElementLike;
    const label = findByType(tree, Typography).map((element) => textContent(element));
    const pagination = findByType(tree, Pagination)[0]!;

    expect(label).toContain('Showing 26–50 of 60 products');
    expect(pagination.props.count).toBe(3);
    expect(pagination.props.page).toBe(2);
    (pagination.props.onChange as (event: unknown, page: number) => void)({}, 3);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
