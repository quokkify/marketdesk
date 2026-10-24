// Cross-marketplace listings overview with status filtering. Rows link through
// to the owning product's detail page. The status filter lives in the URL
// (`?status=error`) so other screens can deep-link to it.
import React, { useMemo } from 'react';
import { Box, MenuItem, Select, Stack } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Listing, ListingStatus } from '@shared/types';
import { LISTING_STATUS_LIST } from '@shared/constants';
import { useDelistListingToDraft, useListings } from '../services/hooks/index.js';
import type { ListingListParams } from '../state/api/index.js';
import { useMarketplaceLookup } from '../hooks/useMarketplaceLookup.js';
import { useAppSelector } from '../state/hooks.js';
import { Card } from '../components/common/Card.js';
import { ListingStatusBadge } from '../components/common/Badge.js';
import { ListingsTable } from '../components/tables/index.js';

const STATUS_PARAM = 'status';

// Known statuses from a comma-separated `status` param, deduplicated, in the
// canonical order; anything else is ignored.
export function parseListingStatusParam(value: string | null): ListingStatus[] {
  const requested = new Set((value ?? '').split(','));
  return LISTING_STATUS_LIST.filter((status) => requested.has(status));
}

export function withListingStatusParam(
  current: URLSearchParams,
  statuses: ListingStatus[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (statuses.length > 0) next.set(STATUS_PARAM, statuses.join(','));
  else next.delete(STATUS_PARAM);
  return next;
}

const ListingsPage: React.FC = () => {
  const navigate = useNavigate();
  const currency = useAppSelector((s) => s.workspace.currency);
  const { resolveMarketplaceName, resolveMarketplaceKey } = useMarketplaceLookup();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get(STATUS_PARAM);
  const statusFilter = useMemo(() => parseListingStatusParam(statusParam), [statusParam]);

  const params = useMemo<ListingListParams>(() => {
    const p: ListingListParams = { sort: '-updatedAt', limit: 100 };
    if (statusFilter.length) p.status = statusFilter;
    return p;
  }, [statusFilter]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListings(params);
  const [delistToDraft, { isLoading: delisting }] = useDelistListingToDraft();

  // GET /listings ignores `status` today, so the fetched rows are filtered
  // here as well; the request keeps the param for when the server honours it.
  const listings = useMemo(
    () =>
      statusFilter.length && data
        ? data.filter((listing: Listing) => statusFilter.includes(listing.status))
        : data,
    [data, statusFilter],
  );

  const handleStatusChange = (e: SelectChangeEvent<ListingStatus[]>) => {
    const value = e.target.value;
    const statuses = parseListingStatusParam(typeof value === 'string' ? value : value.join(','));
    setSearchParams(withListingStatusParam(searchParams, statuses), { replace: true });
  };

  const handleRelist = (listing: Listing) => {
    navigate(`/products/${listing.productId}`, {
      state: { publicationReview: { listingId: listing.id, mode: 'relist' } },
    });
  };

  const handleDelistToDraft = async (listing: Listing, operationId: string) => {
    const operation = await delistToDraft({ id: listing.id, operationId, confirmed: true }).unwrap();
    return operation;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 2.5 }}>
        <Select
          size="small"
          multiple
          displayEmpty
          inputProps={{ 'aria-label': 'Listing status filter' }}
          value={statusFilter}
          onChange={handleStatusChange}
          renderValue={(selected) =>
            selected.length === 0 ? (
              'All statuses'
            ) : (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {selected.map((s) => (
                  <ListingStatusBadge key={s} status={s} />
                ))}
              </Stack>
            )
          }
          sx={{ minWidth: 200 }}
        >
          {LISTING_STATUS_LIST.map((s) => (
            <MenuItem key={s} value={s}>
              <ListingStatusBadge status={s} />
            </MenuItem>
          ))}
        </Select>
      </Stack>

      <Card disablePadding>
        <ListingsTable
          listings={listings}
          loading={isLoading || isFetching}
          error={isError ? error : undefined}
          onRetry={refetch}
          currency={currency}
          resolveMarketplaceName={resolveMarketplaceName}
          resolveMarketplaceKey={resolveMarketplaceKey}
          productHref={(l) => `/products/${l.productId}`}
          onRowClick={(l) => navigate(`/products/${l.productId}`)}
          onRelist={handleRelist}
          onDelistToDraft={handleDelistToDraft}
          actionsDisabled={delisting}
        />
      </Card>
    </Box>
  );
};

export default ListingsPage;
