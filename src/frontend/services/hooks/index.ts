// Ergonomic re-exports of the RTK Query hooks (Group 8).
// List hooks are thin wrappers that inject the active workspaceId from the
// workspace slice; detail queries and mutations are re-exported verbatim with
// friendlier names. Import these from feature components (Group 9) rather than
// reaching into state/api directly.
import { useEffect, useRef, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { baseApi } from '../../state/api/baseApi.js';
import { verdictMark, verdictSettled } from '../../components/products/verdictDisplay.js';
import type { VerdictMark } from '../../components/products/verdictDisplay.js';
import {
  useGetProductsQuery,
  useGetProductQuery,
  useRecheckProductMutation,
  useCreateProductMutation,
  useGenerateProductAIDraftMutation,
  useUploadProductImageMutation,
  useDeleteProductImageMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useCreateProductListingMutation,
  useGetProductListingsQuery,
  useGetListingsQuery,
  useGetListingQuery,
  usePublishListingPreviewMutation,
  useSearchOlxCategoriesMutation,
  useSetListingMarketplaceCategoryMutation,
  usePublishListingMutation,
  useUpdateListingMutation,
  useRelistListingMutation,
  useReactivateListingMutation,
  useGetRevivalProposalMutation,
  useReviveListingMutation,
  useDelistListingToDraftMutation,
  useGetMarketplacesQuery,
  useGetMarketplaceQuery,
  useGetMarketplaceAppCredentialsQuery,
  useSaveMarketplaceAppCredentialsMutation,
  useSyncMarketplaceMutation,
  useImportMarketplacePreviewMutation,
  useImportMarketplaceAdvertsMutation,
  useConnectMarketplaceMutation,
  useCheckMarketplaceQuery,
  useLazyCheckMarketplaceQuery,
  useUpdateMarketplaceMutation,
  useGetHermesEventsQuery,
  useGetHermesEventsFeedInfiniteQuery,
  useGetHermesStatusQuery,
  useGetHermesUsageQuery,
  useGetHermesLimitsQuery,
  useGetHermesEventQuery,
  useApproveHermesEventMutation,
  useDismissHermesEventMutation,
  useExecuteCategoryRecreationOperationMutation,
  useRunHermesMutation,
  useGetProductVerdictQuery,
  useGetResponseViewQuery,
  useRequestResponseRunMutation,
  useGetAnalyticsOverviewQuery,
  useGetPriceHistoryQuery,
  useGetWorkspaceQuery,
  useLoginMutation,
  useRegisterMutation,
  useMeQuery,
  useGetApplicationInfoQuery,
} from '../../state/api/index.js';
import type {
  ProductListParams,
  ListingListParams,
  HermesEventFeedParams,
  HermesEventListParams,
  AnalyticsQueryParams,
} from '../../state/api/index.js';

function useWorkspaceId(): string | undefined {
  return useAppSelector((s) => s.workspace.id) ?? undefined;
}

// The query hooks are generic over `selectFromResult`. Forwarding their options type as it comes
// pins that generic to `Record<string, any>`, which turns a wrapper's `data` into `any`.
type QueryOptions<Hook extends (...args: never[]) => unknown> = Omit<
  NonNullable<Parameters<Hook>[1]>,
  'selectFromResult'
>;

type ProductsOpts = QueryOptions<typeof useGetProductsQuery>;
type ListingsOpts = QueryOptions<typeof useGetListingsQuery>;
type HermesOpts = QueryOptions<typeof useGetHermesEventsQuery>;
type HermesFeedOpts = QueryOptions<typeof useGetHermesEventsFeedInfiniteQuery>;
type OverviewOpts = QueryOptions<typeof useGetAnalyticsOverviewQuery>;

// ---- Products ----
export function useProducts(params: ProductListParams = {}, options?: ProductsOpts) {
  const workspaceId = useWorkspaceId();
  return useGetProductsQuery({ workspaceId, ...params }, options);
}
export const useProduct = useGetProductQuery;
export const useRecheckProduct = useRecheckProductMutation;
export const useProductListings = useGetProductListingsQuery;
export const useCreateProduct = useCreateProductMutation;
export const useGenerateProductAIDraft = useGenerateProductAIDraftMutation;
export const useUploadProductImage = useUploadProductImageMutation;
export const useDeleteProductImage = useDeleteProductImageMutation;
export const useUpdateProduct = useUpdateProductMutation;
export const useDeleteProduct = useDeleteProductMutation;
export const useCreateProductListing = useCreateProductListingMutation;

// ---- Listings ----
export function useListings(params: ListingListParams = {}, options?: ListingsOpts) {
  const workspaceId = useWorkspaceId();
  return useGetListingsQuery({ workspaceId, ...params }, options);
}
export const useListing = useGetListingQuery;
export const usePublishListingPreview = usePublishListingPreviewMutation;
export const useSearchOlxCategories = useSearchOlxCategoriesMutation;
export const useSetListingMarketplaceCategory = useSetListingMarketplaceCategoryMutation;
export const usePublishListing = usePublishListingMutation;
export const useUpdateListing = useUpdateListingMutation;
export const useRelistListing = useRelistListingMutation;
export const useReactivateListing = useReactivateListingMutation;
export const useGetRevivalProposal = useGetRevivalProposalMutation;
export const useReviveListing = useReviveListingMutation;
export const useDelistListingToDraft = useDelistListingToDraftMutation;
export const usePriceHistory = useGetPriceHistoryQuery;

// ---- Marketplaces ----
export const useMarketplaces = useGetMarketplacesQuery;
export const useMarketplace = useGetMarketplaceQuery;
export const useMarketplaceAppCredentials = useGetMarketplaceAppCredentialsQuery;
export const useSaveMarketplaceAppCredentials = useSaveMarketplaceAppCredentialsMutation;
export const useSyncMarketplace = useSyncMarketplaceMutation;
export const useImportMarketplacePreview = useImportMarketplacePreviewMutation;
export const useImportMarketplaceAdverts = useImportMarketplaceAdvertsMutation;
export const useConnectMarketplace = useConnectMarketplaceMutation;
export const useCheckMarketplace = useLazyCheckMarketplaceQuery;
// Subscribes to the OAuth check, the authoritative OLX connection state.
export const useMarketplaceConnection = useCheckMarketplaceQuery;
export const useUpdateMarketplace = useUpdateMarketplaceMutation;

// ---- Hermes ----
export function useHermesEvents(
  params: HermesEventListParams = {},
  options?: HermesOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetHermesEventsQuery({ workspaceId, ...params }, options);
}
// The paged activity feed. `null` filters mean no event can match, so nothing is fetched.
export function useHermesEventFeed(
  filters: HermesEventFeedParams | null,
  options?: HermesFeedOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetHermesEventsFeedInfiniteQuery(
    filters ? { workspaceId, ...filters } : skipToken,
    options,
  );
}
export const useHermesStatus = useGetHermesStatusQuery;
export const useHermesUsage = useGetHermesUsageQuery;
export const useHermesLimits = useGetHermesLimitsQuery;
export const useHermesEvent = useGetHermesEventQuery;
export const useApproveHermesEvent = useApproveHermesEventMutation;
export const useDismissHermesEvent = useDismissHermesEventMutation;
export const useExecuteCategoryRecreationOperation = useExecuteCategoryRecreationOperationMutation;
export const useRunHermes = useRunHermesMutation;
export const useRequestResponseRun = useRequestResponseRunMutation;

export const VERDICT_POLL_MS = 3000;

// The sale verdict of one product. It polls only while a run is active; when the run ends, what
// the run changed (suggestions, price research, the catalogue row) is read again.
export function useProductVerdict(productId: string | undefined) {
  const dispatch = useAppDispatch();
  const [pollingInterval, setPollingInterval] = useState(0);
  const result = useGetProductVerdictQuery(productId ?? skipToken, { pollingInterval });
  const view = result.currentData;
  const mark = useRef<VerdictMark | null>(null);
  useEffect(() => {
    if (!productId || !view) return;
    const next = verdictMark(productId, view);
    setPollingInterval(next.active ? VERDICT_POLL_MS : 0);
    if (verdictSettled(mark.current, next)) {
      dispatch(
        baseApi.util.invalidateTags([
          { type: 'Product', id: 'LIST' },
          { type: 'HermesEvent', id: 'LIST' },
          { type: 'PriceResearch', id: productId },
          { type: 'SaleVerdict', id: productId },
        ])
      );
    }
    mark.current = next;
  }, [view, productId, dispatch]);
  return result;
}

// The listing response view of one product; polls only while a run is active. When the run ends
// the catalogue row, which carries the latest run, is read again.
export function useResponseView(productId: string | undefined) {
  const dispatch = useAppDispatch();
  const [pollingInterval, setPollingInterval] = useState(0);
  const result = useGetResponseViewQuery(productId ?? skipToken, { pollingInterval });
  const view = result.currentData;
  const mark = useRef<VerdictMark | null>(null);
  useEffect(() => {
    if (!productId || !view) return;
    const next: VerdictMark = {
      productId,
      latestId: view.latest?.id ?? null,
      completedAt: view.latest?.completedAt ?? null,
      active: view.active !== null,
    };
    setPollingInterval(next.active ? VERDICT_POLL_MS : 0);
    if (verdictSettled(mark.current, next)) {
      dispatch(baseApi.util.invalidateTags([{ type: 'Product', id: 'LIST' }]));
    }
    mark.current = next;
  }, [view, productId, dispatch]);
  return result;
}

// ---- Analytics ----
export function useAnalyticsOverview(
  params: AnalyticsQueryParams = {},
  options?: OverviewOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetAnalyticsOverviewQuery({ workspaceId, ...params }, options);
}

// ---- Workspace ----
export const useWorkspace = useGetWorkspaceQuery;

// ---- Auth ----
export const useLogin = useLoginMutation;
export const useRegister = useRegisterMutation;
export const useMe = useMeQuery;

// ---- Application information ----
export const useApplicationInfo = useGetApplicationInfoQuery;
