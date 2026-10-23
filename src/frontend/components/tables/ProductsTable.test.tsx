import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, Typography } from '@mui/material';
import type { Product } from '@shared/types';
import {
  CatalogueFooter,
  ProductsCards,
  ProductsTable,
  productRowMenuItems,
} from './ProductsTable';

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
  it('renders product identity, fallback, price/profit/margin/tags and honest marketplace absence', () => {
    const html = renderToStaticMarkup(
      <ProductsTable products={[product]} currency="PLN" selectedIds={new Set(['p-1'])} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('SKU-100');
    expect(html).toContain('WH');
    expect(html).toContain('150 zł');
    expect(html).toContain('60% margin');
    expect(html).toContain('featured');
    expect(html).toContain('Marketplace count unavailable');
    expect(html).toContain('Select all products on this page');
  });

  it('formats money in PLN style and shows when each product was last updated', () => {
    const updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <ProductsTable
        products={[{ ...product, costPrice: 800, sellingPrice: 1050, updatedAt }]}
        currency="PLN"
      />
    );
    expect(html).toContain('800 zł');
    expect(html).toContain('1 050 zł');
    expect(html).toContain('250 zł');
    expect(html).toContain('24% margin');
    expect(html).toContain('2h ago');
  });

  it('offers a row actions menu instead of navigating from the overflow control', () => {
    const html = renderToStaticMarkup(
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
    const empty = renderToStaticMarkup(<ProductsTable products={[]} />);
    const filtered = renderToStaticMarkup(
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

  it('keeps cost, price, profit, tags, updated date and the actions menu in card view', () => {
    const html = renderToStaticMarkup(
      <ProductsCards products={[product]} currency="PLN" onEdit={() => undefined} />
    );
    expect(html).toContain('Wireless Headphones');
    expect(html).toContain('Cost');
    expect(html).toContain('100 zł');
    expect(html).toContain('60% margin');
    expect(html).toContain('Updated');
    expect(html).toContain('aria-label="Actions for Wireless Headphones"');
    expect(html).toContain('Marketplace count unavailable');
  });
});

describe('product row actions menu', () => {
  it('lists Open and Edit and routes each to its handler before closing the menu', () => {
    const onOpen = jest.fn();
    const onEdit = jest.fn();
    const close = jest.fn();
    const items = productRowMenuItems(product, { onOpen, onEdit }, close) as ElementLike[];

    expect(items.map((item) => textContent(item))).toEqual(['Open', 'Edit']);
    (items[0]!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledWith(product);
    (items[1]!.props.onClick as () => void)();
    expect(onEdit).toHaveBeenCalledWith(product);
    expect(close).toHaveBeenCalledTimes(2);
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
