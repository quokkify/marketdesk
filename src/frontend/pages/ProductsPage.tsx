// Products catalogue: server-driven filters/sort (RTK Query) + a client search,
// paginated table, and a "New product" wizard modal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import GridViewIcon from '@mui/icons-material/GridView';
import ListIcon from '@mui/icons-material/ViewList';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/Sort';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import type { Marketplace, Product } from '@shared/types';
import {
  useCreateProduct,
  useGenerateProductAIDraft,
  useUploadProductImage,
  useDeleteProductImage,
  useCheckMarketplace,
  useMarketplaces,
  useProducts,
} from '../services/hooks/index.js';
import type { ProductListParams } from '../state/api/index.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { Card } from '../components/common/Card.js';
import { Modal } from '../components/common/Modal.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useProductDeletion } from '../hooks/useProductDeletion.js';
import { CatalogueFooter, ProductsCards, ProductsTable } from '../components/tables/index.js';
import {
  hasCatalogueFilters,
  parseProductsCatalogueState,
  PRODUCTS_PAGE_SIZE,
  PRODUCT_SEARCH_DEBOUNCE_MS,
  PRODUCT_SORT_OPTIONS,
  productsToCsv,
  tabStatus,
  updateProductsCatalogueSearch,
} from './productsCatalogueState.js';
import type {
  ProductsCatalogueState,
  ProductsTab,
  ProductsView,
} from './productsCatalogueState.js';
import {
  ProductWizardForm,
  hasMeaningfulProductWizardDraft,
  productFieldErrorsFromApi,
  productWizardDraftStorageKey,
  readProductWizardDraft,
  removeProductWizardDraft,
  verifyWizardMarketplaceReadiness,
  writeProductWizardDraft,
} from '../components/forms/index.js';
import type {
  ApiFieldErrors,
  ProductSubmissionValues,
  ProductWizardDraftState,
} from '../components/forms/index.js';
import { PUBLICATION_JOURNEY_VERSION } from '../workflows/publicationJourneyContract.js';

export function shouldBlockProductWizardNavigation(
  wizardOpen: boolean,
  draftDirty: boolean,
  navigationAllowed: boolean,
  currentUrl: string,
  nextUrl: string
): boolean {
  return wizardOpen && draftDirty && !navigationAllowed && currentUrl !== nextUrl;
}

export function shouldDebounceCatalogueSearch(
  wizardOpen: boolean,
  searchInput: string,
  committedSearch: string
): boolean {
  return !wizardOpen && searchInput !== committedSearch;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const workspaceId = useAppSelector((s) => s.workspace.id);
  const userId = useAppSelector((s) => s.auth.user?.id);
  const currency = useAppSelector((s) => s.workspace.currency);

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const catalogue = useMemo(() => parseProductsCatalogueState(location.search), [location.search]);
  const [searchInput, setSearchInput] = useState(catalogue.search);
  const lastUrlSearchRef = useRef(catalogue.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const { requestDelete, dialog: deleteDialog } = useProductDeletion((deleted) =>
    setSelectedIds((current) => {
      if (!current.has(deleted.id)) return current;
      const next = new Set(current);
      next.delete(deleted.id);
      return next;
    })
  );
  const wizardOpen = query.get('newProduct') === '1';

  const navigateCatalogue = useCallback(
    (patch: Partial<ProductsCatalogueState>, replace = false) => {
      navigate(
        {
          pathname: location.pathname,
          search: updateProductsCatalogueSearch(location.search, patch),
        },
        { replace }
      );
    },
    [location.pathname, location.search, navigate]
  );

  useEffect(() => {
    if (catalogue.search === lastUrlSearchRef.current) return;
    lastUrlSearchRef.current = catalogue.search;
    setSearchInput(catalogue.search);
  }, [catalogue.search]);
  useEffect(() => {
    if (!shouldDebounceCatalogueSearch(wizardOpen, searchInput, catalogue.search)) return undefined;
    const timer = window.setTimeout(
      () => navigateCatalogue({ search: searchInput, page: 0 }, true),
      PRODUCT_SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [catalogue.search, navigateCatalogue, searchInput, wizardOpen]);
  const draftKey = useMemo(
    () => (workspaceId && userId ? productWizardDraftStorageKey(workspaceId, userId) : null),
    [userId, workspaceId]
  );
  const [initialDraft, setInitialDraft] = useState<ProductWizardDraftState | null>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const draftLoaded = Boolean(draftKey) && loadedDraftKey === draftKey;
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const allowWizardNavigationRef = useRef(false);
  const shouldBlockWizardNavigation = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      shouldBlockProductWizardNavigation(
        wizardOpen,
        draftDirty,
        allowWizardNavigationRef.current,
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`,
        `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
      ),
    [draftDirty, wizardOpen]
  );
  const blocker = useBlocker(shouldBlockWizardNavigation);

  const readStoredDraft = useCallback(() => {
    return draftKey ? readProductWizardDraft(browserStorage(), draftKey) : null;
  }, [draftKey]);

  const clearStoredDraft = useCallback(() => {
    return draftKey ? removeProductWizardDraft(browserStorage(), draftKey) : false;
  }, [draftKey]);

  const openWizard = () => {
    if (!draftKey) {
      dispatch(
        enqueueToast({
          message: 'Product creation needs an active signed-in workspace.',
          severity: 'warning',
        })
      );
      return;
    }
    allowWizardNavigationRef.current = false;
    const restored = draftKey ? readStoredDraft() : null;
    setInitialDraft(restored);
    setLoadedDraftKey(draftKey);
    setDraftDirty(Boolean(restored && hasMeaningfulProductWizardDraft(restored)));
    setDraftSaveError(false);
    const next = new URLSearchParams(location.search);
    next.set('newProduct', '1');
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  };
  const closeWizard = useCallback(() => {
    const next = new URLSearchParams(location.search);
    next.delete('newProduct');
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const params = useMemo<ProductListParams>(() => {
    const p: ProductListParams = {
      sort: catalogue.sort,
      limit: PRODUCTS_PAGE_SIZE,
      offset: catalogue.page * PRODUCTS_PAGE_SIZE,
    };
    const status = tabStatus(catalogue.tab);
    if (status) p.status = status;
    if (catalogue.search.trim()) p.search = catalogue.search.trim();
    if (catalogue.tags.length) p.tags = catalogue.tags;
    if (catalogue.priceMin.trim() !== '' && !Number.isNaN(Number(catalogue.priceMin))) {
      p.priceMin = Number(catalogue.priceMin);
    }
    if (catalogue.priceMax.trim() !== '' && !Number.isNaN(Number(catalogue.priceMax))) {
      p.priceMax = Number(catalogue.priceMax);
    }
    return p;
  }, [catalogue]);

  const { currentData, isLoading, isFetching, isError, error, refetch } = useProducts(params);
  const allCount = useProducts({ limit: 1, offset: 0 });
  const activeCount = useProducts({ status: ['active'], limit: 1, offset: 0 });
  const attentionCount = useProducts({ status: ['attention'], limit: 1, offset: 0 });
  const draftCount = useProducts({ status: ['draft'], limit: 1, offset: 0 });
  const totalPages = currentData ? Math.ceil(currentData.total / PRODUCTS_PAGE_SIZE) : 0;
  const activeFilterCount =
    catalogue.tags.length + (catalogue.priceMin.trim() ? 1 : 0) + (catalogue.priceMax.trim() ? 1 : 0);
  const activeSortLabel =
    PRODUCT_SORT_OPTIONS.find((option) => option.value === catalogue.sort)?.label ?? 'Custom order';
  const pageOutOfRange = Boolean(currentData && catalogue.page > Math.max(0, totalPages - 1));
  const paginationPage = totalPages > 0 ? Math.min(catalogue.page, totalPages - 1) : 0;
  useEffect(() => {
    if (!currentData || !pageOutOfRange) return;
    navigateCatalogue({ page: Math.max(0, totalPages - 1) }, true);
  }, [currentData, navigateCatalogue, pageOutOfRange, totalPages]);
  const marketplaces = useMarketplaces();
  const [checkMarketplace] = useCheckMarketplace();
  const [verifiedMarketplaces, setVerifiedMarketplaces] = useState<Marketplace[]>();
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState(false);
  const [createProduct, { isLoading: creating }] = useCreateProduct();
  const [generateProductAIDraft] = useGenerateProductAIDraft();
  const [uploadProductImage] = useUploadProductImage();
  const [deleteProductImage] = useDeleteProductImage();

  useEffect(() => {
    if (blocker.state === 'blocked') setLeaveDialogOpen(true);
  }, [blocker.state]);

  useEffect(() => {
    if (wizardOpen && !draftLoaded && draftKey) {
      const restored = readStoredDraft();
      setInitialDraft(restored);
      setDraftDirty(Boolean(restored && hasMeaningfulProductWizardDraft(restored)));
      setDraftSaveError(false);
      setLoadedDraftKey(draftKey);
    } else if (!wizardOpen && loadedDraftKey !== null) {
      setInitialDraft(null);
      setDraftDirty(false);
      setDraftSaveError(false);
      setLoadedDraftKey(null);
      setLeaveDialogOpen(false);
      allowWizardNavigationRef.current = false;
    }
  }, [draftKey, draftLoaded, loadedDraftKey, readStoredDraft, wizardOpen]);

  useEffect(() => {
    if (!wizardOpen || !draftDirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftDirty, wizardOpen]);

  const handleDraftChange = useCallback(
    (draft: ProductWizardDraftState) => {
      const meaningful = hasMeaningfulProductWizardDraft(draft);
      setDraftDirty(meaningful);
      const storage = browserStorage();
      if (!draftKey) {
        setDraftSaveError(meaningful);
        return;
      }
      const saved = meaningful
        ? writeProductWizardDraft(storage, draftKey, draft)
        : removeProductWizardDraft(storage, draftKey);
      setDraftSaveError(!saved);
    },
    [draftKey]
  );

  const completeWizardNavigation = () => {
    allowWizardNavigationRef.current = true;
    setLeaveDialogOpen(false);
    if (blocker.state === 'blocked') blocker.proceed();
    else closeWizard();
  };

  const requestWizardClose = () => {
    if (draftDirty) setLeaveDialogOpen(true);
    else completeWizardNavigation();
  };

  const cancelWizardLeave = () => {
    allowWizardNavigationRef.current = false;
    if (blocker.state === 'blocked') blocker.reset();
    setLeaveDialogOpen(false);
  };

  const keepDraftAndClose = () => {
    if (draftSaveError) {
      dispatch(
        enqueueToast({
          message: 'Draft is kept for this browser session, but will not survive a reload.',
          severity: 'warning',
        })
      );
    }
    completeWizardNavigation();
  };

  const discardDraftAndClose = () => {
    if (draftKey && !clearStoredDraft()) {
      dispatch(
        enqueueToast({
          message: 'Draft discarded for this session; an inaccessible stored copy may remain.',
          severity: 'warning',
        })
      );
    }
    setInitialDraft(null);
    setDraftDirty(false);
    setDraftSaveError(false);
    completeWizardNavigation();
  };

  useEffect(() => {
    let cancelled = false;
    if (!wizardOpen) {
      setVerifiedMarketplaces(undefined);
      setReadinessLoading(false);
      setReadinessError(false);
      return () => {
        cancelled = true;
      };
    }
    if (!marketplaces.data) {
      setVerifiedMarketplaces(undefined);
      setReadinessLoading(marketplaces.isLoading);
      setReadinessError(marketplaces.isError);
      return () => {
        cancelled = true;
      };
    }

    setVerifiedMarketplaces(undefined);
    setReadinessLoading(true);
    setReadinessError(false);
    void verifyWizardMarketplaceReadiness(marketplaces.data, (id) => checkMarketplace(id).unwrap())
      .then((result) => {
        if (cancelled) return;
        setVerifiedMarketplaces(result.marketplaces);
        setReadinessError(
          result.hadCheckError && !result.marketplaces.some((marketplace) => marketplace.connected)
        );
      })
      .catch(() => {
        if (!cancelled) setReadinessError(true);
      })
      .finally(() => {
        if (!cancelled) setReadinessLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    checkMarketplace,
    marketplaces.data,
    marketplaces.isError,
    marketplaces.isLoading,
    wizardOpen,
  ]);

  const items = useMemo<Product[]>(() => currentData?.items ?? [], [currentData?.items]);
  useEffect(() => {
    const visible = new Set(items.map((product) => product.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const selectedProducts = useMemo(
    () => items.filter((product) => selectedIds.has(product.id)),
    [items, selectedIds]
  );
  const clearFilters = () => {
    setSearchInput('');
    navigateCatalogue({ tab: 'all', search: '', tags: [], priceMin: '', priceMax: '', page: 0 });
  };
  const exportSelected = () => {
    const csv = productsToCsv(selectedProducts, currency);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `marketdesk-products-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    dispatch(
      enqueueToast({
        message: `Exported ${selectedProducts.length} selected products.`,
        severity: 'success',
      })
    );
  };

  const openProduct = (product: Product) => navigate(`/products/${product.id}`);
  const editProduct = (product: Product) =>
    navigate(`/products/${product.id}`, { state: { editProduct: true } });

  const handleCreate = async (values: ProductSubmissionValues): Promise<ApiFieldErrors | void> => {
    if (!workspaceId) {
      dispatch(enqueueToast({ message: 'No active workspace selected.', severity: 'error' }));
      return;
    }
    try {
      const { targetMarketplace, ...productValues } = values;
      // No target means no connected marketplace: the product is created as a draft.
      const selectedMarketplace = targetMarketplace
        ? verifiedMarketplaces?.find(
            (marketplace) => marketplace.key === targetMarketplace && marketplace.connected,
          )
        : undefined;
      if (targetMarketplace && !selectedMarketplace) {
        throw new Error('The selected marketplace is no longer connected. Choose it again.');
      }
      const product = await createProduct({ ...productValues, workspaceId }).unwrap();
      const journey = selectedMarketplace
        ? await import('../workflows/publicationJourneyGraph.js').then(({ advancePublicationJourney }) =>
            advancePublicationJourney(
              { phase: 'review' },
              { type: 'product_created', productId: product.id, marketplaceKey: selectedMarketplace.key },
            ),
          )
        : null;
      if (draftKey && !clearStoredDraft()) {
        dispatch(
          enqueueToast({
            message: 'Product created, but the local wizard draft could not be cleared.',
            severity: 'warning',
          })
        );
      }
      setDraftDirty(false);
      setInitialDraft(null);
      allowWizardNavigationRef.current = true;
      if (!journey) {
        dispatch(
          enqueueToast({
            message: 'Product created as a draft. Connect OLX to publish it.',
            severity: 'success',
          })
        );
        navigate(`/products/${product.id}`);
        return;
      }
      dispatch(enqueueToast({ message: 'Product created. Preparing its marketplace listing.', severity: 'success' }));
      navigate(`/products/${product.id}`, {
        state: { publicationJourney: { ...journey, version: PUBLICATION_JOURNEY_VERSION } },
      });
    } catch (err) {
      const rejected = productFieldErrorsFromApi(err);
      if (Object.keys(rejected.fieldErrors).length > 0) return rejected;
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1.25}
        useFlexGap
        sx={{ mb: 2, alignItems: { xs: 'stretch', lg: 'center' } }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={catalogue.tab}
          onChange={(_event, value: ProductsTab | null) =>
            value && navigateCatalogue({ tab: value, page: 0 })
          }
          aria-label="Product status"
          sx={{
            alignSelf: { xs: 'flex-start', lg: 'center' },
            maxWidth: '100%',
            overflowX: 'auto',
            p: 0.5,
            gap: 0.5,
            borderRadius: 3,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            '& .MuiToggleButtonGroup-grouped': {
              border: 0,
              borderRadius: '10px !important',
              px: 1.5,
              whiteSpace: 'nowrap',
              textTransform: 'none',
              fontWeight: 600,
              color: 'text.secondary',
            },
            '& .MuiToggleButtonGroup-grouped.Mui-selected': {
              bgcolor: 'background.paper',
              color: 'text.primary',
              boxShadow: 1,
            },
          }}
        >
          {(
            [
              ['all', 'All', allCount],
              ['active', 'Active', activeCount],
              ['attention', 'Attention', attentionCount],
              ['draft', 'Drafts', draftCount],
            ] as const
          ).map(([value, label, countQuery]) => (
            <ToggleButton key={value} value={value} aria-label={`${label} products`}>
              {label}
              <Chip
                component="span"
                size="small"
                label={
                  countQuery.isLoading || countQuery.isError
                    ? '—'
                    : (countQuery.data?.total ?? 0)
                }
                sx={(theme) => ({
                  ml: 0.75,
                  height: 20,
                  pointerEvents: 'none',
                  fontWeight: 700,
                  bgcolor:
                    catalogue.tab === value
                      ? alpha(theme.palette.primary.main, 0.14)
                      : theme.palette.action.selected,
                  color: catalogue.tab === value ? 'primary.main' : 'text.secondary',
                })}
              />
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="Search name, SKU or tag"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search products' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: { xs: 0, sm: 260 }, bgcolor: 'background.paper' }}
        />
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FilterListIcon />}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="products-filters"
            sx={{ bgcolor: 'background.paper' }}
          >
            Filters
            {activeFilterCount > 0 && (
              <Chip
                component="span"
                size="small"
                color="primary"
                label={activeFilterCount}
                sx={{ ml: 0.75, height: 20, pointerEvents: 'none' }}
              />
            )}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<SortIcon />}
            onClick={(event) => setSortAnchor(event.currentTarget)}
            aria-haspopup="menu"
            aria-controls={sortAnchor ? 'products-sort-menu' : undefined}
            aria-expanded={sortAnchor ? 'true' : undefined}
            aria-label={`Sort products, current order ${activeSortLabel}`}
            sx={{ bgcolor: 'background.paper' }}
          >
            Sort
          </Button>
          <Menu
            id="products-sort-menu"
            anchorEl={sortAnchor}
            open={Boolean(sortAnchor)}
            onClose={() => setSortAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {PRODUCT_SORT_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                selected={option.value === catalogue.sort}
                onClick={() => {
                  setSortAnchor(null);
                  navigateCatalogue({ sort: option.value, page: 0 });
                }}
              >
                <ListItemIcon>
                  {option.value === catalogue.sort && <CheckIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText>{option.label}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={catalogue.view}
            onChange={(_event, value: ProductsView | null) =>
              value && navigateCatalogue({ view: value })
            }
            aria-label="Catalogue view"
            sx={{ bgcolor: 'background.paper' }}
          >
            <ToggleButton value="list" aria-label="List view">
              <ListIcon />
            </ToggleButton>
            <ToggleButton value="card" aria-label="Card view">
              <GridViewIcon />
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>
      <Collapse in={filtersOpen} id="products-filters">
        <Card sx={{ mb: 2 }} contentSx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
          >
            <TextField
              size="small"
              type="number"
              label="Minimum price"
              value={catalogue.priceMin}
              onChange={(event) => navigateCatalogue({ priceMin: event.target.value, page: 0 }, true)}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              size="small"
              type="number"
              label="Maximum price"
              value={catalogue.priceMax}
              onChange={(event) => navigateCatalogue({ priceMax: event.target.value, page: 0 }, true)}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <Autocomplete
              multiple
              freeSolo
              size="small"
              options={[]}
              value={catalogue.tags}
              onChange={(_event, next) => navigateCatalogue({ tags: next as string[], page: 0 })}
              renderValue={(value, getItemProps) =>
                value.map((tag, index) => {
                  const { key, ...itemProps } = getItemProps({ index });
                  return (
                    <Chip key={key} variant="outlined" size="small" label={tag} {...itemProps} />
                  );
                })
              }
              renderInput={(params) => (
                <TextField {...params} label="Tags" placeholder="Type and press Enter" />
              )}
              sx={{ minWidth: 240, flex: 1 }}
            />
            <Button onClick={clearFilters} disabled={!hasCatalogueFilters(catalogue)}>
              Clear filters
            </Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 1.5 }}>
            Marketplace, margin and updated-date filters are not shown because the catalogue API
            does not expose those filters yet.
          </Alert>
        </Card>
      </Collapse>

      {selectedIds.size > 0 && (
        <Box
          role="region"
          aria-label="Bulk product actions"
          sx={{
            position: 'sticky',
            top: 72,
            zIndex: 5,
            mb: 2,
            p: 1.25,
            borderRadius: 2,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            boxShadow: 4,
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            sx={{ alignItems: { xs: 'stretch', md: 'center' } }}
          >
            <Typography sx={{ px: 1, fontWeight: 800 }}>{selectedIds.size} selected</Typography>
            <Divider
              orientation="vertical"
              flexItem
              sx={{ borderColor: 'rgba(255,255,255,.3)', display: { xs: 'none', md: 'block' } }}
            />
            {[
              [<LocalOfferOutlinedIcon key="tag" />, 'Add tag'],
              [<EditOutlinedIcon key="price" />, 'Edit price'],
              [<DeleteOutlineIcon key="delete" />, 'Delete'],
            ].map(([icon, label]) => (
              <Button
                key={String(label)}
                disabled
                startIcon={icon}
                aria-describedby="bulk-actions-note"
                sx={{ '&.Mui-disabled': { color: 'inherit', opacity: 0.6 } }}
              >
                {label}
              </Button>
            ))}
            <Button color="inherit" startIcon={<DownloadIcon />} onClick={exportSelected}>
              Export CSV
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button color="inherit" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </Button>
          </Stack>
          <Typography
            id="bulk-actions-note"
            variant="caption"
            sx={{ display: 'block', px: 1, opacity: 0.9 }}
          >
            Bulk tag, price and delete changes are not available yet. Export works on the selected
            rows.
          </Typography>
        </Box>
      )}

      <Card disablePadding>
        {catalogue.view === 'list' ? (
          <ProductsTable
            products={items}
            loading={isLoading || isFetching || pageOutOfRange}
            error={isError ? error : undefined}
            onRetry={refetch}
            currency={currency}
            sort={catalogue.sort}
            onSortChange={(sort) => navigateCatalogue({ sort, page: 0 })}
            onOpen={openProduct}
            onEdit={editProduct}
            onDelete={requestDelete}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyFiltered={hasCatalogueFilters(catalogue) || (currentData?.total ?? 0) > 0}
            clearFiltersAction={<Button onClick={clearFilters}>Clear filters</Button>}
            emptyAction={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>
                Create your first product
              </Button>
            }
          />
        ) : (
          <ProductsCards
            products={items}
            loading={isLoading || isFetching || pageOutOfRange}
            error={isError ? error : undefined}
            onRetry={refetch}
            currency={currency}
            onOpen={openProduct}
            onEdit={editProduct}
            onDelete={requestDelete}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyFiltered={hasCatalogueFilters(catalogue) || (currentData?.total ?? 0) > 0}
            clearFiltersAction={<Button onClick={clearFilters}>Clear filters</Button>}
            emptyAction={
              <Button variant="contained" startIcon={<AddIcon />} onClick={openWizard}>
                Create your first product
              </Button>
            }
          />
        )}
        {(currentData?.total ?? 0) > 0 && (
          <CatalogueFooter
            total={currentData?.total ?? 0}
            page={paginationPage}
            pageSize={PRODUCTS_PAGE_SIZE}
            onPageChange={(page) => navigateCatalogue({ page })}
          />
        )}
      </Card>

      <Modal
        open={wizardOpen}
        onClose={requestWizardClose}
        title="New product"
        subtitle="Add a product to your catalogue in a few steps."
        maxWidth="md"
      >
        {!draftKey ? (
          <Alert severity="warning">
            Product creation needs an active signed-in workspace. Finish account setup or select a
            workspace, then try again.
          </Alert>
        ) : draftLoaded ? (
          <ProductWizardForm
            initialDraft={initialDraft}
            onDraftChange={handleDraftChange}
            submitting={creating}
            marketplaces={verifiedMarketplaces}
            marketplacesLoading={readinessLoading}
            marketplacesError={readinessError}
            currency={currency}
            onSubmit={handleCreate}
            onGenerateAIDraft={(request) => generateProductAIDraft(request).unwrap()}
            onUploadImage={(file) => uploadProductImage(file).unwrap()}
            onDeleteImage={async (imageId) => {
              await deleteProductImage(imageId).unwrap();
            }}
            onCancel={requestWizardClose}
          />
        ) : (
          <Alert severity="info">Loading your saved product draft…</Alert>
        )}
      </Modal>
      <ConfirmDialog
        open={leaveDialogOpen}
        title="Leave product creation?"
        message={
          draftSaveError
            ? 'This draft is available for the current browser session, but local storage failed. Reloading or closing the tab may lose it.'
            : 'Your progress is saved locally. Keep the draft for later or discard it.'
        }
        cancelLabel="Keep editing"
        alternateLabel="Save draft and close"
        confirmLabel="Discard draft"
        confirmColor="error"
        onCancel={cancelWizardLeave}
        onAlternate={keepDraftAndClose}
        onConfirm={discardDraftAndClose}
      />
      {deleteDialog}
    </Box>
  );
};

export default ProductsPage;
