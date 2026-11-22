import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, Typography } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import type { Product } from '@shared/types';
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
      'updated',
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

  it('links the product title to its page', () => {
    const html = markup(<ProductsTable products={[product]} onOpen={() => {}} />);
    expect(html).toContain('href="/products/p-1"');
  });

  it.each([
    [{ metaKey: false, ctrlKey: false, button: 0, insideStop: false }, 'open'],
    [{ metaKey: true, ctrlKey: false, button: 0, insideStop: false }, 'new-tab'],
    [{ metaKey: false, ctrlKey: true, button: 0, insideStop: false }, 'new-tab'],
    [{ metaKey: false, ctrlKey: false, button: 1, insideStop: false }, 'new-tab'],
    [{ metaKey: false, ctrlKey: false, button: 0, insideStop: true }, 'ignore'],
    [{ metaKey: true, ctrlKey: false, button: 0, insideStop: true }, 'ignore'],
  ] as const)('row click %o opens as %s', (event, intent) => {
    expect(rowClickIntent(event)).toBe(intent);
  });

  it('formats money in PLN style and shows when each product was last updated', () => {
    const updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const html = markup(
      <ProductsTable
        products={[{ ...product, costPrice: 800, sellingPrice: 1050, updatedAt }]}
        currency="PLN"
      />
    );
    expect(html).toContain('1 050 zł');
    expect(html).not.toContain('800 zł');
    expect(html).toContain('2h ago');
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
