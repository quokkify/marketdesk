import React from 'react';
import { Button } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HermesEvent, Listing, PriceHistory, Product } from '@shared/types';
import { darkTheme } from '../../theme/darkTheme';
import { lightTheme } from '../../theme/lightTheme';
import {
  OlxInsightsCard,
  PriceHistoryCard,
  PricingSummaryCard,
  ProductActivityCard,
  productActivityItems,
  ProductHermesCard,
  productHeroMenuItems,
  PublicationReadinessSection,
  ProductCategoryEvidence,
  ProductDescriptionCard,
  productDetailGridSx,
  ProductGalleryCard,
  ProductIdentityHero,
  productDetailRailSx,
  ProductTimelineCard,
} from './ProductDetailSections';

const product: Product = {
  id: 'product-1',
  workspaceId: 'workspace-1',
  sku: 'SKU-38412',
  name: 'Wireless Headphones Pro',
  description: 'Real product description',
  costPrice: 149,
  sellingPrice: 329,
  condition: 'new',
  category: 'Audio',
  status: 'active',
  tags: ['audio', 'wireless'],
  images: ['https://example.test/cover.jpg', 'https://example.test/side.jpg'],
  createdAt: '2026-07-14T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
};

const listing: Listing = {
  id: 'listing-1',
  productId: product.id,
  marketplaceId: 'olx-id',
  marketplaceListingId: 'olx-123',
  externalUrl: 'https://www.olx.pl/d/oferta/olx-123',
  price: 329,
  status: 'live',
  remoteStatus: 'active',
  remoteStatusLabel: 'Active',
  isRemotePending: false,
  views: 125,
  watchers: null,
  conversations: 2,
  messages: 4,
  metricsAvailability: { views: true, watchers: false, conversations: true, messages: true },
  publishedAt: '2026-07-15T10:00:00.000Z',
  lastSyncAt: '2026-07-16T09:00:00.000Z',
  createdAt: '2026-07-15T09:00:00.000Z',
  updatedAt: '2026-07-16T09:00:00.000Z',
};

const history: PriceHistory[] = [
  { id: 'price-2', listingId: listing.id, oldPrice: 349, newPrice: 329, changedBy: 'hermes', reason: 'Approved recommendation', createdAt: '2026-07-16T08:00:00.000Z' },
  { id: 'price-1', listingId: listing.id, newPrice: 349, changedBy: 'user', createdAt: '2026-07-15T08:00:00.000Z' },
];

function render(node: React.ReactNode, dark = false) {
  return renderToStaticMarkup(<ThemeProvider theme={dark ? darkTheme : lightTheme}>{node}</ThemeProvider>);
}

describe('product detail redesign sections', () => {
  it('renders populated identity, gallery, pricing, real OLX metrics, history and timeline', () => {
    const html = render(<>
      <ProductIdentityHero product={product} onEdit={() => undefined} />
      <ProductGalleryCard name={product.name} images={product.images} activeIndex={0} onSelect={() => undefined} />
      <PricingSummaryCard product={product} currency="PLN" primaryAction="edit" externalUrl={listing.externalUrl} onEdit={() => undefined} />
      <OlxInsightsCard listing={listing} isOlx statusTitle="OLX listing" statusLabel="Active on OLX" statusExplanation="Provider status" statusColor="success" />
      <PriceHistoryCard listing={listing} history={history} loading={false} currency="PLN" />
      <ProductTimelineCard product={product} listing={listing} />
    </>);

    expect(html).toContain('Wireless Headphones Pro');
    expect(html).toContain('<h1');
    expect(html).toContain('SKU-38412');
    expect(html).toContain('photo 1');
    expect(html).toContain('125');
    expect(html).toContain('Unknown');
    expect(html).toContain('Conversations');
    expect(html).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))');
    expect(html).toContain('data-testid="olx-insights-metrics"');
    expect(html).toContain('OLX chats');
    expect(html).toContain('Conversion is not shown');
    expect(html).toContain('Recorded price history chart');
    expect(html).toContain('Approved recommendation');
    expect(html).toContain('Marketplace status and data synced');
  });

  it('renders honest empty image, description, tag, listing, metric and price states', () => {
    const emptyProduct = { ...product, description: '', tags: [], images: [], costPrice: null };
    const html = render(<>
      <ProductGalleryCard name={emptyProduct.name} images={[]} activeIndex={0} onSelect={() => undefined} />
      <ProductDescriptionCard product={emptyProduct} onEdit={() => undefined} />
      <PricingSummaryCard product={emptyProduct} currency="PLN" primaryAction="edit" onEdit={() => undefined} />
      <OlxInsightsCard isOlx={false} statusTitle="OLX listing" statusLabel="Not synced" statusExplanation="Unavailable" statusColor="default" />
      <PriceHistoryCard loading={false} currency="PLN" />
    </>);

    expect(html).toContain('No images yet');
    expect(html).toContain('No description has been added');
    expect(html).toContain('No tags');
    expect(html).toContain('No OLX listing is connected');
    expect(html).toContain('No marketplace listing exists yet');
    expect(html).toContain('Cost unknown');
  });

  it('keeps loading and error states distinct from honest empty states', () => {
    const loadingHtml = render(<>
      <OlxInsightsCard loading isOlx={false} statusTitle="OLX listing" statusLabel="Unknown" statusExplanation="Unknown" statusColor="default" />
      <PriceHistoryCard listing={listing} loading currency="PLN" />
    </>);
    const errorHtml = render(<>
      <OlxInsightsCard error={{ status: 503 }} isOlx={false} statusTitle="OLX listing" statusLabel="Unknown" statusExplanation="Unknown" statusColor="default" />
      <PriceHistoryCard listing={listing} error={{ status: 503 }} loading={false} currency="PLN" />
    </>);

    expect(loadingHtml).not.toContain('No OLX listing is connected');
    expect(loadingHtml).not.toContain('No price changes recorded yet');
    expect(errorHtml).toContain('OLX listing data unavailable');
    expect(errorHtml).toContain('Price history unavailable');
    expect(errorHtml).not.toContain('No OLX listing is connected');
  });

  it('preserves exact category provenance and freshness evidence', () => {
    const withProvenance: Product = {
      ...product,
      categoryProvenance: {
        status: 'synced',
        sources: [{
          marketplaceKey: 'olx', marketplaceId: 'olx-id', listingId: 'listing-1',
          providerCategoryId: '2078', name: 'Wireless headphones',
          path: ['Electronics', 'Headphones', 'Wireless headphones'],
          taxonomyVerifiedAt: '2026-07-15T00:00:00.000Z',
          syncedAt: '2026-07-16T00:00:00.000Z',
        }],
      },
    };
    const html = render(<ProductCategoryEvidence product={withProvenance} conflictLines={[]} />);

    expect(html).toContain('provider category ID 2078');
    expect(html).toContain('listing listing-1');
    expect(html).toContain('Taxonomy verified');
    expect(html).toContain('synced');
  });

  it('defines a narrow single-column layout and desktop sticky recommendation rail', () => {
    expect(productDetailGridSx.gridTemplateColumns).toEqual(expect.objectContaining({
      xs: 'minmax(0, 1fr)',
      lg: 'minmax(0, 1fr) minmax(300px, 360px)',
    }));
    expect(productDetailRailSx.position).toEqual({ xs: 'static', lg: 'sticky' });
  });

  it.each([false, true])('renders using theme palette tokens in %s mode', (dark) => {
    const html = render(<ProductIdentityHero product={product} onEdit={() => undefined} />, dark);
    expect(html).toContain('Wireless Headphones Pro');
    expect(html).not.toContain('undefined');
  });
});

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

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

describe('product detail pricing card actions', () => {
  it('detail renders Publish to OLX for drafts', () => {
    const onPublish = jest.fn();
    const draft = { ...product, status: 'draft' as const };
    const html = render(<PricingSummaryCard product={draft} currency="PLN" primaryAction="publish" onPublish={onPublish} onEdit={() => undefined} />);
    const buttons = findByType(
      PricingSummaryCard({ product: draft, currency: 'PLN', primaryAction: 'publish', onPublish, onEdit: () => undefined }) as ElementLike,
      Button,
    );

    expect(html).toContain('Publish to OLX');
    expect(html).toContain('Edit product');
    expect(html).toContain('329 zł');
    expect(html).toContain('Cost 149 zł');
    expect(html).toContain('180 zł');
    expect(html).toContain('55% margin');
    (buttons.find((button) => textContent(button) === 'Publish to OLX')!.props.onClick as () => void)();
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('offers Edit product and Open on OLX for a live listing', () => {
    const html = render(<PricingSummaryCard product={product} currency="PLN" primaryAction="edit" externalUrl={listing.externalUrl} onEdit={() => undefined} />);

    expect(html).toContain('Edit product');
    expect(html).toContain('Open on OLX');
    expect(html).toContain('href="https://www.olx.pl/d/oferta/olx-123"');
    expect(html).not.toContain('Publish to OLX');
  });

  it('labels a live sandbox advert instead of opening OLX', () => {
    const html = render(<PricingSummaryCard product={product} currency="PLN" primaryAction="edit" externalUrl={listing.externalUrl} sandboxAdvert onEdit={() => undefined} />);

    expect(html).toContain('Edit product');
    expect(html).toContain('Sandbox advert');
    expect(html).not.toContain('Open on OLX');
    expect(html).not.toContain('href="https://www.olx.pl');
  });

  it('asks to connect OLX instead of offering a publish action that cannot work', () => {
    const onConnect = jest.fn();
    const draft = { ...product, status: 'draft' as const };
    const html = render(<PricingSummaryCard product={draft} currency="PLN" primaryAction="connect" onConnect={onConnect} onEdit={() => undefined} />);

    expect(html).toContain('Connect OLX');
    expect(html).toContain('Publishing needs a connected OLX account.');
    expect(html).not.toContain('Publish to OLX');
  });

  it('offers a relist for an expired or failed OLX listing', () => {
    const html = render(<PricingSummaryCard product={product} currency="PLN" primaryAction="relist" onRelist={() => undefined} onEdit={() => undefined} />);

    expect(html).toContain('Relist on OLX');
  });
});

describe('product detail hero actions', () => {
  it('delete action present in the hero overflow menu', () => {
    const onDelete = jest.fn();
    const close = jest.fn();
    const html = render(<ProductIdentityHero product={product} onEdit={() => undefined} onDelete={onDelete} />);
    const items = productHeroMenuItems(onDelete, close) as ElementLike[];

    expect(html).toContain('aria-label="More actions for Wireless Headphones Pro"');
    expect(items.map((item) => textContent(item))).toEqual(['Delete product']);
    (items[0]!.props.onClick as () => void)();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows no overflow menu when the product cannot be deleted from here', () => {
    const html = render(<ProductIdentityHero product={product} onEdit={() => undefined} />);

    expect(html).not.toContain('More actions for');
  });
});

describe('product detail statistics card', () => {
  it('labels sandbox OLX data next to the provider status', () => {
    const sandbox = render(<OlxInsightsCard listing={listing} isOlx sandbox statusTitle="OLX listing" statusLabel="Active on OLX" statusExplanation="Provider status" statusColor="success" />);
    const real = render(<OlxInsightsCard listing={listing} isOlx statusTitle="OLX listing" statusLabel="Active on OLX" statusExplanation="Provider status" statusColor="success" />);
    const noListing = render(<OlxInsightsCard isOlx={false} sandbox statusTitle="OLX listing" statusLabel="Not synced" statusExplanation="Unavailable" statusColor="default" />);

    expect(sandbox).toContain('Statistics');
    expect(sandbox).toContain('Sandbox');
    expect(sandbox).toContain('Simulated by the OLX sandbox');
    expect(sandbox).not.toContain('OLX-reported');
    expect(real).not.toContain('Sandbox');
    expect(real).toContain('OLX-reported status and metrics only');
    expect(noListing).toContain('Sandbox');
  });

  it('labels a live sandbox advert instead of opening OLX', () => {
    const live = render(<OlxInsightsCard listing={listing} isOlx sandbox statusTitle="OLX listing" statusLabel="Active on OLX" statusExplanation="Provider status" statusColor="success" />);
    const draft = render(<OlxInsightsCard listing={{ ...listing, status: 'draft', externalUrl: undefined }} isOlx sandbox statusTitle="OLX listing" statusLabel="Not synced" statusExplanation="Provider status" statusColor="default" />);

    expect(live).toContain('Sandbox advert');
    expect(live).not.toContain('Open OLX');
    expect(live).not.toContain('href="https://www.olx.pl');
    expect(draft).not.toContain('Sandbox advert');
  });
});

describe('product detail activity', () => {
  const recommendation: HermesEvent = {
    id: 'event-1',
    workspaceId: 'workspace-1',
    productId: product.id,
    type: 'suggested_better_title',
    severity: 'info',
    status: 'pending_review',
    title: 'Suggested better title',
    proposedChange: { kind: 'title', field: 'title', from: 'Old', to: 'New' },
    createdAt: '2026-07-16T09:30:00.000Z',
  };

  it('lists actor-attributed price changes and Hermes suggestions, newest first', () => {
    const items = productActivityItems(history, [recommendation], 'PLN');

    expect(items.map((item) => [item.actor, item.title, item.detail])).toEqual([
      ['hermes', 'Suggested better title', 'Waiting for your review'],
      ['hermes', 'Changed the price 349 zł → 329 zł', 'Approved recommendation'],
      ['user', 'Set the price to 349 zł', undefined],
    ]);
  });

  it('renders actor names and an honest empty state', () => {
    const html = render(<ProductActivityCard items={productActivityItems(history, [], 'PLN')} />);
    const empty = render(<ProductActivityCard items={[]} />);

    expect(html).toContain('Hermes');
    expect(html).toContain('A user');
    expect(html).toContain('Changed the price 349 zł → 329 zł');
    expect(empty).toContain('No recorded price changes or Hermes suggestions yet.');
  });

  it('keeps loading and error states distinct from the empty activity state', () => {
    const loading = render(<ProductActivityCard items={[]} loading />);
    const failed = render(<ProductActivityCard items={[]} error={{ status: 503 }} onRetry={() => undefined} />);

    expect(loading).not.toContain('No recorded price changes or Hermes suggestions yet.');
    expect(failed).toContain('Activity unavailable');
    expect(failed).not.toContain('No recorded price changes or Hermes suggestions yet.');
  });
});

describe('product detail Hermes card', () => {
  it('offers Analyze with Hermes and Suggest improvements and routes each to its handler', () => {
    const onAnalyze = jest.fn();
    const onSuggest = jest.fn();
    const tree = ProductHermesCard({
      analyzing: false,
      analyzeDisabled: false,
      suggesting: false,
      note: 'Runs only the enabled listing SEO agent for this product.',
      onAnalyze,
      onSuggest,
      children: <p>Pending recommendations</p>,
    }) as ElementLike;
    const buttons = findByType(tree, Button);
    const html = render(tree);

    expect(buttons.map((button) => textContent(button))).toEqual(['Analyze with Hermes', 'Suggest improvements']);
    (buttons[0]!.props.onClick as () => void)();
    (buttons[1]!.props.onClick as () => void)();
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    expect(onSuggest).toHaveBeenCalledTimes(1);
    expect(html).toContain('Runs only the enabled listing SEO agent for this product.');
    expect(html).toContain('Pending recommendations');
  });

  it('names the active provider while the analysis runs and stays neutral while it is unknown', () => {
    const analyzingLabel = (activeProvider?: 'hermes' | 'offline') => {
      const tree = ProductHermesCard({
        analyzing: true,
        analyzeDisabled: false,
        suggesting: false,
        note: 'Analyzing this product only.',
        activeProvider,
        onAnalyze: () => undefined,
        onSuggest: () => undefined,
      }) as ElementLike;
      return textContent(findByType(tree, Button)[0]);
    };

    expect(analyzingLabel('hermes')).toBe('Analyzing with Hermes…');
    expect(analyzingLabel('offline')).toBe('Analyzing with offline heuristics…');
    expect(analyzingLabel(undefined)).toBe('Analyzing…');
  });

  it('disables analysis with its reason and reports a failed run as an alert', () => {
    const blocked = ProductHermesCard({
      analyzing: false,
      analyzeDisabled: true,
      suggesting: true,
      note: 'Enable the listing SEO agent in Hermes settings first.',
      onAnalyze: () => undefined,
      onSuggest: () => undefined,
    }) as ElementLike;
    const [analyze, suggest] = findByType(blocked, Button);
    const failed = render(
      <ProductHermesCard
        analyzing={false}
        analyzeDisabled={false}
        suggesting={false}
        note="Hermes is unavailable"
        noteIsError
        onAnalyze={() => undefined}
        onSuggest={() => undefined}
      />
    );

    expect(analyze!.props.disabled).toBe(true);
    expect(suggest!.props.disabled).toBe(true);
    expect(textContent(suggest)).toBe('Preparing suggestions…');
    expect(render(blocked)).toContain('Enable the listing SEO agent in Hermes settings first.');
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Hermes is unavailable');
  });
});

describe('publication readiness section', () => {
  it('starts collapsed inside the Hermes card', () => {
    const html = render(
      <PublicationReadinessSection action={<button type="button">Check again</button>}>
        <p>Readiness result</p>
      </PublicationReadinessSection>,
    );

    expect(html).toContain('Publication readiness check');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Readiness result');
    expect(html).not.toContain('Check again');
  });
});
