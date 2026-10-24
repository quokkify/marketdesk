import React, { useId, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { HermesEvent, Listing, PriceHistory, Product } from '@shared/types';
import { Card } from '../common/Card.js';
import { ProductStatusBadge } from '../common/Badge.js';
import { LoadingSkeleton } from '../common/Skeleton.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { profitSummary } from '../forms/productFormModel.js';
import { formatDateTime, formatMoney, formatRelative } from '../../utils/formatters.js';
import { conditionLabel } from '../../utils/labels.js';

export const mainPreviewImageSx = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  margin: 'auto',
} as const;

export const productDetailGridSx = {
  display: 'grid',
  gap: { xs: 2, lg: 3 },
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(300px, 360px)' },
  alignItems: 'start',
} as const;

export const productDetailRailSx = {
  position: { xs: 'static', lg: 'sticky' },
  top: { lg: 88 },
  minWidth: 0,
} as const;

const EmptyState: React.FC<{ title: string; detail: string }> = ({ title, detail }) => (
  <Stack spacing={1} sx={{ minHeight: 150, px: 2, textAlign: 'center', alignItems: 'center', justifyContent: 'center' }}>
    <ImageOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
    <Typography variant="subtitle2">{title}</Typography>
    <Typography variant="body2" color="text.secondary">{detail}</Typography>
  </Stack>
);

export const ProductIdentityHero: React.FC<{
  product: Product;
  onEdit: () => void;
}> = ({ product, onEdit }) => (
  <Box
    component="section"
    aria-labelledby="product-detail-title"
    sx={{
      mb: { xs: 2, md: 3 },
      p: { xs: 2, md: 3 },
      borderRadius: 3,
      border: '1px solid',
      borderColor: 'divider',
      bgcolor: 'background.paper',
      backgroundImage: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}12, transparent 48%)`,
    }}
  >
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, flexWrap: 'wrap' }}>
          <ProductStatusBadge status={product.status} />
          <Chip size="small" variant="outlined" label={conditionLabel(product.condition)} />
          {product.category && <Chip size="small" variant="outlined" label={product.category} />}
        </Stack>
        <Typography id="product-detail-title" component="h1" variant="h2" sx={{ overflowWrap: 'anywhere' }}>
          {product.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {`SKU ${product.sku || 'unavailable'} · Updated ${formatRelative(product.updatedAt)}`}
        </Typography>
      </Box>
      <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ alignSelf: { sm: 'flex-start' } }}>
        Edit product
      </Button>
    </Stack>
  </Box>
);

export const ProductGalleryCard: React.FC<{
  name: string;
  images: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
}> = ({ name, images, activeIndex, onSelect }) => {
  const selected = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  return (
    <Card title="Gallery" subtitle={images.length ? `${images.length} product photo${images.length === 1 ? '' : 's'}` : 'No product photos'}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: images.length > 1 ? 'minmax(0, 1fr) 76px' : '1fr' }, gap: 1.5 }}>
        <Box sx={{ minHeight: { xs: 260, md: 420 }, aspectRatio: '16 / 10', borderRadius: 2.5, overflow: 'hidden', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {images.length ? <Box component="img" src={images[selected]} alt={`${name}, photo ${selected + 1}`} sx={mainPreviewImageSx} /> : <EmptyState title="No images yet" detail="Add product photos when they are available." />}
        </Box>
        {images.length > 1 && (
          <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} sx={{ overflow: 'auto', pb: { xs: 0.5, sm: 0 } }} aria-label="Product gallery thumbnails">
            {images.map((image, index) => (
              <IconButton
                key={`${image}:${index}`}
                aria-label={`Show photo ${index + 1}`}
                aria-pressed={index === selected}
                onClick={() => onSelect(index)}
                sx={{ p: 0.5, borderRadius: 2, flex: '0 0 auto', border: '2px solid', borderColor: index === selected ? 'primary.main' : 'transparent', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
              >
                <Box component="img" src={image} alt="" sx={{ width: 60, height: 60, borderRadius: 1.25, objectFit: 'cover' }} />
              </IconButton>
            ))}
          </Stack>
        )}
      </Box>
    </Card>
  );
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
    <Typography component="div" variant="body2" sx={{ fontWeight: 600, mt: 0.25, overflowWrap: 'anywhere' }}>{children}</Typography>
  </Box>
);

export const ProductDescriptionCard: React.FC<{ product: Product; onEdit: () => void }> = ({ product, onEdit }) => (
  <Card title="Description & details" action={<Button size="small" startIcon={<EditOutlinedIcon />} onClick={onEdit}>Edit</Button>}>
    <Typography variant="body2" color={product.description ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
      {product.description || 'No description has been added.'}
    </Typography>
    <Divider sx={{ my: 2 }} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
      <Fact label="Condition">{conditionLabel(product.condition)}</Fact>
      <Fact label="Category">{product.category || 'Unknown'}</Fact>
    </Box>
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
      {product.tags.length ? product.tags.map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />) : <Typography variant="caption" color="text.secondary">No tags</Typography>}
    </Stack>
  </Card>
);

export const ProductCategoryEvidence: React.FC<{ product: Product; conflictLines: string[] }> = ({ product, conflictLines }) => {
  const provenance = product.categoryProvenance;
  if (!provenance) return null;
  return (
    <Card title="Category evidence" subtitle="Exact provider taxonomy evidence">
      {provenance.status === 'synced' ? (
        <Stack spacing={1.25}>
          {provenance.sources.map((source) => (
            <Box key={`${source.marketplaceId}:${source.listingId}`} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{source.path.join(' → ')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {source.marketplaceKey.toUpperCase()} · listing {source.listingId} · provider category ID {source.providerCategoryId}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Taxonomy verified {formatDateTime(source.taxonomyVerifiedAt)} · synced {formatDateTime(source.syncedAt)}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Alert severity="warning">Conflicting active listing categories require review.</Alert>
          {conflictLines.map((line) => <Typography key={line} variant="caption" sx={{ overflowWrap: 'anywhere' }}>{line}</Typography>)}
          <Typography variant="caption" color="text.secondary">
            Conflict detected {formatDateTime(provenance.detectedAt)}
          </Typography>
        </Stack>
      )}
    </Card>
  );
};

export type ProductPrimaryAction = 'publish' | 'relist' | 'connect' | 'edit';

const PRIMARY_ACTION_LABEL: Record<Exclude<ProductPrimaryAction, 'edit'>, string> = {
  publish: 'Publish to OLX',
  relist: 'Relist on OLX',
  connect: 'Connect OLX',
};

export const PricingSummaryCard: React.FC<{
  product: Product;
  currency: string;
  primaryAction: ProductPrimaryAction;
  externalUrl?: string;
  busy?: boolean;
  onEdit: () => void;
  onPublish?: () => void;
  onRelist?: () => void;
  onConnect?: () => void;
}> = ({ product, currency, primaryAction, externalUrl, busy = false, onEdit, onPublish, onRelist, onConnect }) => {
  const pricing = profitSummary(product.costPrice, product.sellingPrice);
  const primaryHandler = { publish: onPublish, relist: onRelist, connect: onConnect }[
    primaryAction as Exclude<ProductPrimaryAction, 'edit'>
  ];
  return (
    <Card sx={{ borderColor: 'primary.main' }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>Selling price</Typography>
        <ProductStatusBadge status={product.status} />
      </Stack>
      <Typography variant="h3" sx={{ mt: 0.5, fontWeight: 800 }}>{formatMoney(product.sellingPrice, currency)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        {pricing ? (
          <>
            {`Cost ${formatMoney(product.costPrice, currency)} · Profit `}
            <Box component="span" sx={{ fontWeight: 700, color: pricing.profit < 0 ? 'error.main' : 'success.main' }}>
              {formatMoney(pricing.profit, currency)}
            </Box>
            {pricing.marginPercent === null ? '' : ` · ${Math.round(pricing.marginPercent)}% margin`}
          </>
        ) : (
          'Cost unknown, so profit and margin are not calculated.'
        )}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        {primaryAction === 'edit' ? (
          <>
            <Button fullWidth variant="contained" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ minHeight: 44 }}>Edit product</Button>
            {externalUrl && (
              <Button fullWidth variant="outlined" component="a" href={externalUrl} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon />} sx={{ minHeight: 44 }}>Open on OLX</Button>
            )}
          </>
        ) : (
          <>
            <Button fullWidth variant="contained" disabled={busy || !primaryHandler} onClick={primaryHandler} sx={{ minHeight: 44 }}>
              {PRIMARY_ACTION_LABEL[primaryAction]}
            </Button>
            <Button fullWidth variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} sx={{ minHeight: 44 }}>Edit product</Button>
          </>
        )}
      </Stack>
      {primaryAction === 'connect' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Publishing needs a connected OLX account.
        </Typography>
      )}
    </Card>
  );
};

const metricValue = (listing: Listing, key: 'views' | 'watchers' | 'conversations' | 'messages') => {
  const available = listing.metricsAvailability?.[key] ?? listing[key] != null;
  return available && listing[key] != null ? String(listing[key]) : 'Unknown';
};

export const OlxInsightsCard: React.FC<{
  listing?: Listing;
  isOlx: boolean;
  sandbox?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  statusTitle: string;
  statusLabel: string;
  statusExplanation: string;
  statusColor: 'default' | 'success' | 'warning' | 'error';
}> = ({ listing, isOlx, sandbox = false, loading = false, error, onRetry, statusTitle, statusLabel, statusExplanation, statusColor }) => (
  <Card
    title="Statistics"
    subtitle="OLX-reported status and metrics only"
    action={sandbox ? <Chip size="small" color="warning" variant="outlined" label="Sandbox" /> : undefined}
  >
    {loading ? (
      <LoadingSkeleton lines={3} height={40} />
    ) : error ? (
      <ErrorRetry error={error} onRetry={onRetry} title="OLX listing data unavailable" compact />
    ) : !listing || !isOlx ? (
      <Alert severity="info">No OLX listing is connected. Provider metrics are unavailable.</Alert>
    ) : (
      <Stack spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">{statusTitle}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip size="small" label={statusLabel} color={statusColor} variant="outlined" />
            {listing.externalUrl && <Button component="a" href={listing.externalUrl} target="_blank" rel="noreferrer" size="small" endIcon={<OpenInNewIcon />}>Open OLX</Button>}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{statusExplanation}</Typography>
          {listing.lastSyncAt && <Typography variant="caption" color="text.secondary">Last checked {formatDateTime(listing.lastSyncAt)}</Typography>}
        </Box>
        <Box
          data-testid="olx-insights-metrics"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}
        >
          {(['views', 'watchers', 'conversations', 'messages'] as const).map((key) => (
            <Box key={key} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover', minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', textTransform: 'capitalize', lineHeight: 1.25, overflowWrap: 'anywhere' }}
              >
                {key}
              </Typography>
              <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{metricValue(listing, key)}</Typography>
            </Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary">Conversations are OLX chats; messages are total messages inside those chats. Conversion is not shown because no provider conversion metric exists.</Typography>
      </Stack>
    )}
  </Card>
);

function sparklinePoints(history: PriceHistory[]): string {
  const ordered = [...history].reverse();
  const values = ordered.map((item) => item.newPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = max === min ? 20 : 38 - ((value - min) / (max - min)) * 32;
    return `${x},${y}`;
  }).join(' ');
}

export const PriceHistoryCard: React.FC<{
  listing?: Listing;
  history?: PriceHistory[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  currency: string;
}> = ({ listing, history = [], loading, error, onRetry, currency }) => (
  <Card title="Price history" subtitle={listing ? `Current listing price ${formatMoney(listing.price, currency)}` : 'Real listing price changes'}>
    {loading ? <LoadingSkeleton lines={3} height={32} /> : error ? <ErrorRetry error={error} onRetry={onRetry} title="Price history unavailable" compact /> : !listing ? <Typography variant="body2" color="text.secondary">No marketplace listing exists yet.</Typography> : history.length === 0 ? <Typography variant="body2" color="text.secondary">No price changes recorded yet.</Typography> : (
      <Stack spacing={1.5}>
        <Box component="svg" role="img" aria-label="Recorded price history chart" viewBox="0 0 100 42" preserveAspectRatio="none" sx={{ width: '100%', height: 96, color: 'primary.main', overflow: 'visible' }}>
          <polyline points={sparklinePoints(history)} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </Box>
        <Stack divider={<Divider />}>
          {history.map((entry) => (
            <Stack key={entry.id} direction={{ xs: 'column', sm: 'row' }} spacing={0.5} sx={{ py: 1, justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{entry.oldPrice != null ? `${formatMoney(entry.oldPrice, currency)} → ${formatMoney(entry.newPrice, currency)}` : formatMoney(entry.newPrice, currency)}</Typography>
                <Typography variant="caption" color="text.secondary">{entry.changedBy}{entry.reason ? ` · ${entry.reason}` : ''}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">{formatDateTime(entry.createdAt)}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    )}
  </Card>
);

export const ProductTimelineCard: React.FC<{ product: Product; listing?: Listing }> = ({ product, listing }) => {
  const events = [
    { key: 'updated', label: 'Product updated', at: product.updatedAt },
    ...(listing?.lastSyncAt ? [{ key: 'synced', label: 'Marketplace status and data synced', at: listing.lastSyncAt }] : []),
    ...(listing?.publishedAt ? [{ key: 'published', label: 'Listing published to marketplace', at: listing.publishedAt }] : []),
    { key: 'created', label: 'Product created', at: product.createdAt },
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <Card title="Timeline" subtitle="Recorded product and listing events">
      <Stack spacing={0}>
        {events.map((event, index) => (
          <Stack key={event.key} direction="row" spacing={1.5}>
            <Stack sx={{ alignItems: 'center' }}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: index === 0 ? 'primary.main' : 'text.disabled', mt: 0.5 }} />{index < events.length - 1 && <Box sx={{ width: 2, minHeight: 42, flexGrow: 1, bgcolor: 'divider' }} />}</Stack>
            <Box sx={{ pb: 2 }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{event.label}</Typography><Typography variant="caption" color="text.secondary" title={formatDateTime(event.at)}>{formatRelative(event.at)}</Typography></Box>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};

export interface ProductActivityItem {
  id: string;
  actor: 'hermes' | 'user';
  title: string;
  detail?: string;
  at: string;
}

const ACTIVITY_LIMIT = 8;
const ACTOR_LABEL: Record<ProductActivityItem['actor'], string> = { hermes: 'Hermes', user: 'A user' };

// Activity with a known actor: recorded price changes and pending Hermes suggestions.
export function productActivityItems(
  history: PriceHistory[],
  events: HermesEvent[],
  currency: string,
): ProductActivityItem[] {
  const priceChanges: ProductActivityItem[] = history.map((entry) => ({
    id: `price:${entry.id}`,
    actor: entry.changedBy,
    title:
      entry.oldPrice != null
        ? `Changed the price ${formatMoney(entry.oldPrice, currency)} → ${formatMoney(entry.newPrice, currency)}`
        : `Set the price to ${formatMoney(entry.newPrice, currency)}`,
    detail: entry.reason,
    at: entry.createdAt,
  }));
  const suggestions: ProductActivityItem[] = events.map((event) => ({
    id: `event:${event.id}`,
    actor: 'hermes',
    title: event.title,
    detail: event.status === 'pending_review' ? 'Waiting for your review' : undefined,
    at: event.createdAt,
  }));
  return [...priceChanges, ...suggestions]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, ACTIVITY_LIMIT);
}

export const ProductActivityCard: React.FC<{
  items: ProductActivityItem[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}> = ({ items, loading = false, error, onRetry }) => (
  <Card title="Activity" subtitle="Price changes and Hermes suggestions">
    {loading ? (
      <LoadingSkeleton lines={3} height={36} />
    ) : error ? (
      <ErrorRetry error={error} onRetry={onRetry} title="Activity unavailable" compact />
    ) : items.length === 0 ? (
      <Typography variant="body2" color="text.secondary">No recorded price changes or Hermes suggestions yet.</Typography>
    ) : (
      <Stack spacing={1.5}>
        {items.map((item) => (
          <Stack key={item.id} direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
            <Avatar
              aria-hidden
              sx={(theme) => ({
                width: 28,
                height: 28,
                fontSize: '0.75rem',
                fontWeight: 700,
                bgcolor: alpha(item.actor === 'hermes' ? theme.palette.primary.main : theme.palette.text.secondary, 0.14),
                color: item.actor === 'hermes' ? theme.palette.primary.main : theme.palette.text.secondary,
              })}
            >
              {item.actor === 'hermes' ? 'H' : 'U'}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{ACTOR_LABEL[item.actor]}</Typography>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.title}</Typography>
              {item.detail && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.detail}</Typography>}
            </Box>
            <Typography variant="caption" color="text.secondary" title={formatDateTime(item.at)} sx={{ whiteSpace: 'nowrap' }}>{formatRelative(item.at)}</Typography>
          </Stack>
        ))}
      </Stack>
    )}
  </Card>
);

// Hermes actions for one product. Everything Hermes produces stays review-only.
export const ProductHermesCard: React.FC<{
  analyzing: boolean;
  analyzeDisabled: boolean;
  suggesting: boolean;
  note: string;
  noteIsError?: boolean;
  onAnalyze: () => void;
  onSuggest: () => void;
  children?: React.ReactNode;
}> = ({ analyzing, analyzeDisabled, suggesting, note, noteIsError = false, onAnalyze, onSuggest, children }) => (
  <Card
    title="Hermes"
    subtitle="Review-only suggestions for this product"
    sx={{
      borderColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.32),
      bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.03),
    }}
  >
    <Stack spacing={2}>
      <Stack spacing={1}>
        <Button fullWidth variant="contained" startIcon={<AutoAwesomeOutlinedIcon />} disabled={analyzing || analyzeDisabled} onClick={onAnalyze}>
          {analyzing ? 'Analyzing with Hermes…' : 'Analyze with Hermes'}
        </Button>
        <Button fullWidth variant="outlined" disabled={suggesting} onClick={onSuggest}>
          {suggesting ? 'Preparing suggestions…' : 'Suggest improvements'}
        </Button>
        <Typography variant="caption" color={noteIsError ? 'error.main' : 'text.secondary'} role={noteIsError ? 'alert' : undefined}>
          {note}
        </Typography>
      </Stack>
      {children}
    </Stack>
  </Card>
);

export const PublicationReadinessSection: React.FC<{
  action: React.ReactNode;
  children?: React.ReactNode;
}> = ({ action, children }) => {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  return (
    <Box>
      <ButtonBase
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={expanded ? regionId : undefined}
        sx={{
          width: '100%',
          py: 0.75,
          borderRadius: 1,
          justifyContent: 'space-between',
          textAlign: 'left',
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        <Box>
          <Typography variant="subtitle2">Publication readiness check</Typography>
          <Typography variant="caption" color="text.secondary">Checks the saved product without publishing</Typography>
        </Box>
        <ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </ButtonBase>
      <Collapse in={expanded} unmountOnExit>
        <Stack id={regionId} spacing={1.5} sx={{ pt: 1 }}>
          <Box>{action}</Box>
          {children}
        </Stack>
      </Collapse>
    </Box>
  );
};
