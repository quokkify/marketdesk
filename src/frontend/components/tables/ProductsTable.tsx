import React, { useId, useState } from 'react';
import {
  Avatar,
  Box,
  Checkbox,
  Link,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import { Link as RouterLink } from 'react-router-dom';
import type { Product } from '@shared/types';
import { formatDateTime, formatMoney, formatRelative } from '../../utils/formatters.js';
import { ProductStatusBadge } from '../common/Badge.js';
import { awaitingReplyLabel } from '../product-detail/conversationsState.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { EmptyState } from '../common/EmptyState.js';
import {
  catalogueFooterLabel,
  productInitials,
  productTileTone,
  shortListingSku,
} from '../../pages/productsCatalogueState.js';

const SKU_FONT = '"JetBrains Mono", ui-monospace, monospace';

type SortDir = 'asc' | 'desc';

function parseSort(sort?: string): { field: string; dir: SortDir } | null {
  if (!sort) return null;
  const first = sort.split(',')[0]?.trim();
  if (!first) return null;
  if (first.startsWith('-')) return { field: first.slice(1), dir: 'desc' };
  if (first.startsWith('+')) return { field: first.slice(1), dir: 'asc' };
  return { field: first, dir: 'asc' };
}

function ProductThumbnail({ product }: { product: Product }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = product.images[0];
  if (image && image !== failedImage) {
    return (
      <Box
        component="img"
        src={image}
        alt=""
        onError={() => setFailedImage(image)}
        sx={{ width: 44, height: 44, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const tone = productTileTone(product.sku);
  return (
    <Avatar
      variant="rounded"
      aria-label={`${product.name} image unavailable`}
      sx={(theme) => ({
        width: 44,
        height: 44,
        borderRadius: 1.5,
        bgcolor: alpha(theme.palette[tone].main, theme.palette.mode === 'dark' ? 0.22 : 0.14),
        color: theme.palette.mode === 'dark' ? theme.palette[tone].light : theme.palette[tone].dark,
        fontWeight: 800,
        fontSize: '0.875rem',
      })}
    >
      {productInitials(product.name)}
    </Avatar>
  );
}

function AwaitingReplyBadge({ count }: { count: number | undefined }) {
  const label = awaitingReplyLabel(count);
  return label ? <Chip size="small" color="warning" label={label} sx={{ ml: 1 }} /> : null;
}

function ProductIdentity({ product }: { product: Product }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
      <ProductThumbnail product={product} />
      <Box sx={{ minWidth: 0 }}>
        <Link
          component={RouterLink}
          to={`/products/${product.id}`}
          underline="hover"
          color="text.primary"
          variant="body2"
          title={product.name}
          onClick={(event: React.MouseEvent) => event.stopPropagation()}
          sx={{
            fontWeight: 700,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {product.name}
        </Link>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={product.sku}
          sx={{ display: 'block', fontFamily: SKU_FONT }}
        >
          {shortListingSku(product.sku)}
        </Typography>
      </Box>
    </Stack>
  );
}

function UpdatedAt({ value }: { value: string }) {
  return (
    <Box component="span" title={formatDateTime(value)}>
      {formatRelative(value)}
    </Box>
  );
}

export type ProductTableColumnKey =
  | 'select'
  | 'product'
  | 'status'
  | 'price'
  | 'updated'
  | 'ai'
  | 'actions';

export const PRODUCT_TABLE_COLUMNS: ReadonlyArray<{
  key: ProductTableColumnKey;
  label: string;
  sortField?: string;
  align?: 'right';
}> = [
  { key: 'select', label: '' },
  { key: 'product', label: 'Product', sortField: 'name' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'price', label: 'Price', sortField: 'sellingPrice', align: 'right' },
  { key: 'updated', label: 'Updated', sortField: 'updatedAt', align: 'right' },
  { key: 'ai', label: 'AI' },
  { key: 'actions', label: '' },
];

// Cells marked data-row-stop (checkbox, AI, actions) never open the product.
export function rowClickIntent(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  button: number;
  insideStop: boolean;
}): 'open' | 'new-tab' | 'ignore' {
  if (event.insideStop) return 'ignore';
  if (event.metaKey || event.ctrlKey || event.button === 1) return 'new-tab';
  return 'open';
}

function handleRowClick(
  event: React.MouseEvent<HTMLElement>,
  product: Product,
  onOpen: ((product: Product) => void) | undefined
) {
  if (!onOpen) return;
  const target = event.target as HTMLElement;
  const intent = rowClickIntent({
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    button: event.button,
    insideStop: Boolean(target.closest('[data-row-stop]')),
  });
  if (intent === 'open') onOpen(product);
  else if (intent === 'new-tab') window.open(`/products/${product.id}`, '_blank', 'noopener');
}

export interface ProductRowHandlers {
  onOpen?: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
}

// Menu entries for one catalogue row; built as plain elements so the order and
// handler wiring stay checkable without a DOM.
export function productRowMenuItems(
  product: Product,
  handlers: ProductRowHandlers,
  close: () => void
): React.ReactElement[] {
  const run = (handler: (product: Product) => void) => () => {
    close();
    handler(product);
  };
  const items: React.ReactElement[] = [];
  if (handlers.onOpen) {
    items.push(
      <MenuItem key="open" onClick={run(handlers.onOpen)}>
        <ListItemIcon>
          <OpenInNewOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Open</ListItemText>
      </MenuItem>
    );
  }
  if (handlers.onEdit) {
    items.push(
      <MenuItem key="edit" onClick={run(handlers.onEdit)}>
        <ListItemIcon>
          <EditOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Edit</ListItemText>
      </MenuItem>
    );
  }
  if (handlers.onDelete) {
    items.push(
      <MenuItem key="delete" onClick={run(handlers.onDelete)} sx={{ color: 'error.main' }}>
        <ListItemIcon>
          <DeleteOutlineIcon fontSize="small" color="error" />
        </ListItemIcon>
        <ListItemText>Delete</ListItemText>
      </MenuItem>
    );
  }
  return items;
}

export const ProductRowActions: React.FC<{ product: Product; handlers: ProductRowHandlers }> = ({
  product,
  handlers,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const items = productRowMenuItems(product, handlers, () => setAnchorEl(null));
  if (items.length === 0) return null;
  return (
    <>
      <IconButton
        size="small"
        aria-label={`Actions for ${product.name}`}
        aria-haspopup="menu"
        aria-controls={anchorEl ? menuId : undefined}
        aria-expanded={anchorEl ? 'true' : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {items}
      </Menu>
    </>
  );
};

export const CatalogueFooter: React.FC<{
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}> = ({ total, page, pageSize, onPageChange }) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{
        px: 2.5,
        py: 1.75,
        borderTop: 1,
        borderColor: 'divider',
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'space-between',
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {catalogueFooterLabel(total, page, pageSize)}
      </Typography>
      <Pagination
        count={pageCount}
        page={Math.min(page, pageCount - 1) + 1}
        onChange={(_event, next) => onPageChange(next - 1)}
        shape="rounded"
        color="primary"
        size="small"
        aria-label="Catalogue pages"
      />
    </Stack>
  );
};

export interface ProductsCollectionProps {
  products?: Product[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onOpen?: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  currency?: string;
  emptyAction?: React.ReactNode;
  emptyFiltered?: boolean;
  clearFiltersAction?: React.ReactNode;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  awaitingByProductId?: Record<string, number>;
}

export type ProductsTableProps = ProductsCollectionProps;

function CollectionState(props: ProductsCollectionProps): React.ReactNode | null {
  if (props.error) return <ErrorRetry error={props.error} onRetry={props.onRetry} />;
  if (!props.loading && (!props.products || props.products.length === 0)) {
    return (
      <EmptyState
        icon={<Inventory2OutlinedIcon sx={{ fontSize: 52 }} />}
        title={props.emptyFiltered ? 'No products match' : 'Your catalogue is empty'}
        description={
          props.emptyFiltered
            ? 'Try clearing filters or using a broader search.'
            : 'Create your first product to start managing marketplace listings.'
        }
        action={props.emptyFiltered ? props.clearFiltersAction : props.emptyAction}
      />
    );
  }
  return null;
}

function toggleSelection(selected: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(selected);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

export const ProductsTable: React.FC<ProductsCollectionProps> = (props) => {
  const { products = [], loading = false, selectedIds = new Set(), onSelectionChange } = props;
  const state = CollectionState(props);
  if (state) return state;
  const active = parseSort(props.sort);
  const allSelected =
    products.length > 0 && products.every((product) => selectedIds.has(product.id));
  const someSelected = products.some((product) => selectedIds.has(product.id));
  const handleSort = (field: string) => {
    const nextDir: SortDir = active?.field === field && active.dir === 'asc' ? 'desc' : 'asc';
    props.onSortChange?.(`${nextDir === 'desc' ? '-' : ''}${field}`);
  };
  const sortHeading = (label: string, field: string) => (
    <TableSortLabel
      active={active?.field === field}
      direction={active?.field === field ? active.dir : 'asc'}
      onClick={() => handleSort(field)}
    >
      {label}
    </TableSortLabel>
  );

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="medium" sx={{ minWidth: 820 }} aria-label="Products catalogue">
        <TableHead>
          <TableRow>
            {PRODUCT_TABLE_COLUMNS.map((column) => {
              if (column.key === 'select') {
                return (
                  <TableCell key={column.key} padding="checkbox">
                    <Checkbox
                      slotProps={{ input: { 'aria-label': 'Select all products on this page' } }}
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onChange={(_event, checked) =>
                        onSelectionChange?.(
                          checked ? new Set(products.map((product) => product.id)) : new Set()
                        )
                      }
                    />
                  </TableCell>
                );
              }
              if (column.key === 'actions') {
                return <TableCell key={column.key} align="right" aria-label="Actions" />;
              }
              return (
                <TableCell
                  key={column.key}
                  align={column.align}
                  sx={column.key === 'product' ? { minWidth: 280 } : undefined}
                >
                  {column.sortField ? sortHeading(column.label, column.sortField) : column.label}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {PRODUCT_TABLE_COLUMNS.map((column, cell) => (
                    <TableCell key={column.key}>
                      <Skeleton width={cell === 1 ? 190 : 70} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : products.map((product) => (
                <TableRow
                  key={product.id}
                  hover
                  selected={selectedIds.has(product.id)}
                  onClick={(event) => handleRowClick(event, product, props.onOpen)}
                  onAuxClick={(event) => handleRowClick(event, product, props.onOpen)}
                  sx={{ cursor: props.onOpen ? 'pointer' : undefined }}
                >
                  <TableCell padding="checkbox" data-row-stop>
                    <Checkbox
                      slotProps={{ input: { 'aria-label': `Select ${product.name}` } }}
                      checked={selectedIds.has(product.id)}
                      onChange={(_event, checked) =>
                        onSelectionChange?.(toggleSelection(selectedIds, product.id, checked))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <ProductIdentity product={product} />
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                    <AwaitingReplyBadge count={props.awaitingByProductId?.[product.id]} />
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatMoney(product.sellingPrice, props.currency)}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    <UpdatedAt value={product.updatedAt} />
                  </TableCell>
                  <TableCell data-row-stop />
                  <TableCell align="right" data-row-stop>
                    <ProductRowActions
                      product={product}
                      handlers={{ onOpen: props.onOpen, onEdit: props.onEdit, onDelete: props.onDelete }}
                    />
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export const ProductsCards: React.FC<ProductsCollectionProps> = (props) => {
  const { products = [], loading = false, selectedIds = new Set(), onSelectionChange } = props;
  const state = CollectionState(props);
  if (state) return state;
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
        },
        gap: 2,
        p: 2,
      }}
    >
      {(loading ? Array.from({ length: 8 }) : products).map((entry, index) => {
        if (!entry) return <Skeleton key={index} variant="rounded" height={210} />;
        const product = entry as Product;
        return (
          <Box
            key={product.id}
            component="article"
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Checkbox
                size="small"
                slotProps={{ input: { 'aria-label': `Select ${product.name}` } }}
                checked={selectedIds.has(product.id)}
                onChange={(_event, checked) =>
                  onSelectionChange?.(toggleSelection(selectedIds, product.id, checked))
                }
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <ProductIdentity product={product} />
              </Box>
              <ProductStatusBadge status={product.status} />
              <AwaitingReplyBadge count={props.awaitingByProductId?.[product.id]} />
              <ProductRowActions
                product={product}
                handlers={{ onOpen: props.onOpen, onEdit: props.onEdit, onDelete: props.onDelete }}
              />
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 1,
                mt: 2,
                pt: 1.5,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Price
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatMoney(product.sellingPrice, props.currency)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Updated
                </Typography>
                <Typography variant="body2">
                  <UpdatedAt value={product.updatedAt} />
                </Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default ProductsTable;
