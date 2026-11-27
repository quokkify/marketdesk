// OLX Partner API adapter. Maps domain listing data to the documented
// `POST /api/partner/adverts` contract. The HTTP boundary stays injectable so
// OAuth credentials are resolved per marketplace account by the publish worker.

import { randomUUID } from 'node:crypto';
import { BaseMarketplaceAdapter, type MarketplaceAdapterOptions } from './BaseMarketplaceAdapter';
import {
  type MarketplaceHttpClient,
  StubMarketplaceHttpClient,
  HttpError,
  type HttpRequestConfig,
  type StubResponder,
  type HttpResponse,
} from './MarketplaceHttpClient';
import type {
  ImportDiscoveryOptions,
  ImportedMarketplaceListing,
  ListingPublishInput,
  MarketplaceMessage,
  MarketplaceThreadMessages,
  MarketplaceThread,
  PublishResult,
  SyncedListing,
} from '../../domain/services/MarketplaceAdapter';
import {
  appendSandboxSellerMessage,
  sandboxThreadMessages,
  sandboxThreadsForAdvert,
} from './olxSandboxConversations';
import { evaluateOlxCategory, OLX_CONDITION_REQUIRED_MESSAGE } from '../../domain/services/OlxCategoryGuard';
import { ValidationError } from '../../domain/shared/DomainError';
import { OlxTaxonomyResolver, type OlxTrustedTaxonomyResolver } from './OlxTaxonomyResolver';
import type { MarketplaceCategoryMetadata } from '../../../shared/types';
import type { AdvertAttribute, OlxCategoryAttribute } from '../../domain/services/advertCompletenessRules';

const OLX_PARTNER_BASE_URL = 'https://www.olx.pl/api/partner';
const OLX_THREAD_PAGE_SIZE = 100;
const OLX_THREAD_MAX_PAGES = 1_000;

// Stub/demo fallback only. Real mode sets requirePublishDetails=true and must
// provide an approved category id instead of relying on these placeholders.
const STUB_CATEGORY_MAP: Record<string, number> = {
  electronics: 2000,
  clothing: 3000,
  home: 4000,
  toys: 5000,
  sports: 6000,
};

// Stub transport only. Every read of a sandbox advert adds these counts, so
// repeated syncs show deterministic, growing engagement. The read counts live at
// module scope because the workers build a fresh adapter for every job; they are
// in memory only and reset when the process restarts.
const STUB_VIEWS_PER_READ = 7;
const STUB_FAVORITES_PER_READ = 1;
const stubAdvertReads = new Map<string, number>();

// OLX returns both `value` and `values`; a remote attribute is passed through as read.
export type OlxAttribute = { code: string; value?: string | null; values?: unknown[] | null };

// Stub transport only: like OLX, a PUT replaces the stored attributes and packages, so
// a test can tell whether an update kept what the seller set. Module scope for the same
// reason as the read counts.
const stubAdverts = new Map<string, { attributes: OlxAttribute[]; deliveryPackageIds: string[] }>();
// The advert's category for advertFields on the stub; the single-advert GET never carries it (sync reads it there).
const stubAdvertCategories = new Map<string, string>();
const STUB_DEFAULT_CATEGORY_ID = '5091';
const STUB_PROJECTOR_CATEGORY_ID = '1984';
const stubPackage = (code: string, size: 'S' | 'M', n: number) => ({
  code,
  label: `InPost Paczkomat® 24/7 ${size}${n > 1 ? ` (${n})` : ''}`,
});
const STUB_CATEGORY_ATTRIBUTES: OlxCategoryAttribute[] = [
  {
    code: 'state',
    label: 'Stan',
    required: true,
    multiple: false,
    values: [{ code: 'used', label: 'Używane' }, { code: 'new', label: 'Nowe' }],
  },
  {
    code: 'brand',
    label: 'Marka',
    required: false,
    multiple: false,
    values: ['Apple', 'AOPEN', 'sandbox-seller-brand'].map((code) => ({ code, label: code })),
  },
  {
    code: 'type',
    label: 'Typ',
    required: false,
    multiple: false,
    values: ['dokanalowe', 'nauszne', 'LED'].map((code) => ({ code, label: code })),
  },
  { code: 'bdo', label: 'BDO', required: false, multiple: false, values: [] },
  {
    code: 'delivery',
    label: 'Przesyłka',
    required: false,
    multiple: true,
    values: [
      stubPackage('a1111111-0000-4000-8000-000000000001', 'S', 1),
      stubPackage('a1111111-0000-4000-8000-000000000002', 'S', 2),
      stubPackage('a1111111-0000-4000-8000-000000000003', 'S', 3),
      stubPackage('a1111111-0000-4000-8000-000000000004', 'S', 4),
      stubPackage('b2222222-0000-4000-8000-000000000001', 'M', 1),
      stubPackage('b2222222-0000-4000-8000-000000000002', 'M', 2),
    ],
  },
];
const STUB_ADVERT_DEFAULT_ATTRIBUTES: OlxAttribute[] = [
  { code: 'state', value: 'used' },
  { code: 'brand', value: 'sandbox-seller-brand' },
];

// A remote attribute holds a seller value: a non-null value or a non-empty values list.
function isSetAttribute(attribute: OlxAttribute): boolean {
  const value = attribute.value as unknown;
  return (value !== null && value !== undefined) || (Array.isArray(attribute.values) && attribute.values.length > 0);
}

function isScalar(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

// Keeps the remote order; an owned code replaces the remote value in place and new owned codes are appended.
export function mergeAdvertAttributes(remote: OlxAttribute[], owned: OlxAttribute[]): OlxAttribute[] {
  const ownedByCode = new Map(owned.map((attribute) => [attribute.code, attribute]));
  const merged = remote.map((attribute) => ownedByCode.get(attribute.code) ?? attribute);
  const remoteCodes = new Set(remote.map((attribute) => attribute.code));
  for (const attribute of owned) {
    if (!remoteCodes.has(attribute.code)) merged.push(attribute);
  }
  return merged;
}

const OLX_CONDITION_MAP: Record<string, string> = {
  new: 'new',
  like_new: 'used',
  good: 'used',
  fair: 'used',
  poor: 'used',
  refurbished: 'used',
};

// Observed/supported OLX Partner advert lifecycle vocabulary. Transient states
// remain non-destructive; unknown values are surfaced to the sync handler via
// remoteStatus and must not force local state changes.
const OLX_STATUS_TO_LOCAL: Record<string, SyncedListing['status']> = {
  active: 'live',
  activated: 'live',
  live: 'live',
  published: 'live',
  new: 'live',
  moderation: 'live',
  pending: 'live',
  limited: 'live',
  expired: 'expired',
  // Documented OLX Partner API advert statuses that are not live.
  outdated: 'expired',
  removed_by_user: 'expired',
  removed_by_moderator: 'expired',
  moderated: 'error',
  removed: 'expired',
  deactivated: 'expired',
  deleted: 'expired',
  closed: 'expired',
  rejected: 'error',
  blocked: 'error',
  error: 'error',
};

export interface OlxAdapterConfig {
  baseUrl?: string;
  // Public base URL of this backend; relative image paths are sent to OLX on it.
  publicBaseUrl?: string;
  requirePublishDetails?: boolean;
  categoryIds?: Record<string, number>;
  defaultCategoryId?: number;
  cityId?: number;
  districtId?: number;
  contactName?: string;
  contactPhone?: string;
  advertiserType?: 'private' | 'business';
  priceNegotiable?: boolean;
  conditionAttributeCode?: string;
  deliveryAttributeCode?: string;
  deliveryOptionCode?: string;
}

interface OlxAdvertResponse {
  id: string | number;
  status: string;
  title?: string;
  description?: string | null;
  // The OLX Partner API Advert schema carries only `category_id`; `category` is kept for older payloads.
  category_id?: number | string | null;
  category?: { id?: string | number; name?: string; path?: string[] | string; leaf?: boolean } | string | null;
  url?: string | null;
  public_url?: string | null;
  external_url?: string | null;
  price?: { value?: number | string; currency?: string } | number | string | null;
  photos?: Array<{ url?: string | null }>;
  images?: Array<{ url?: string | null }>;
  updated_at?: string | null;
  // Przesyłka OLX packages chosen by the seller; Poland only, see the Advert schema.
  ad_delivery?: { delivery_package_ids?: unknown } | null;
  attributes?: unknown;
  metrics?: { views?: unknown; favorites?: unknown; favourites?: unknown; watchers?: unknown; messages?: unknown };
  statistics?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  counters?: Record<string, unknown>;
}

interface OlxAdvertListResponse {
  data: OlxAdvertResponse[];
  links?: { next?: string | null };
  meta?: { last_page?: number };
}

interface OlxAdvertStatisticsResponse extends Record<string, unknown> {
  advert_views?: unknown;
  phone_views?: unknown;
  users_observing?: unknown;
}

interface OlxThreadMetadata {
  uuid?: unknown;
  id?: unknown;
  advert_id?: unknown;
  interlocutor_id?: unknown;
  total_count?: unknown;
}

interface OlxMessage {
  uuid?: unknown;
  id?: unknown;
  created_at?: unknown;
  type?: unknown;
  text?: unknown;
}

type OlxMessageListResponse = OlxMessage[] | { data: OlxMessage[] };

type OlxIdentified = { uuid?: unknown; id?: unknown };

type OlxSendMessageResponse = OlxIdentified | { data?: OlxIdentified } | null;

type OlxThreadListResponse = OlxThreadMetadata[] | {
  data: OlxThreadMetadata[];
  links?: { next?: string | null };
  meta?: { current_page?: number; last_page?: number };
};

type OlxAdvertStatisticsResult =
  | { status: 'success'; data: OlxAdvertStatisticsResponse }
  | { status: 'unavailable'; data: null }
  | { status: 'error'; data: null };

type OlxThreadMetricsResult =
  | { status: 'success'; conversations: number; messages: number }
  | { status: 'unavailable'; conversations: null; messages: null }
  | { status: 'error'; conversations: null; messages: null };

interface OlxResponseEnvelope<T> {
  data: T;
}

export class OLXAdapter extends BaseMarketplaceAdapter {
  private readonly baseUrl: string;
  private readonly publicBaseUrl: string | undefined;
  private readonly onStubTransport: boolean;

  constructor(
    http?: MarketplaceHttpClient,
    options?: MarketplaceAdapterOptions,
    private readonly config: OlxAdapterConfig = {},
    private readonly taxonomy: OlxTrustedTaxonomyResolver = new OlxTaxonomyResolver(
      http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder),
      config.baseUrl ?? OLX_PARTNER_BASE_URL,
    ),
  ) {
    super(http ?? new StubMarketplaceHttpClient(OLXAdapter.stubResponder), 'olx', options);
    this.baseUrl = (config.baseUrl ?? OLX_PARTNER_BASE_URL).replace(/\/$/, '');
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/+$/, '');
    this.onStubTransport = http === undefined;
  }

  protected async doPublish(input: ListingPublishInput): Promise<PublishResult> {
    this.assertConditionChosen(input);
    const categoryId = this.resolvePublishCategory(input);
    this.assertPublishDetails(categoryId);
    return this.sendPreparedAdvert(this.createAdvertRequest(this.buildAdvertPayload(input, categoryId)));
  }

  async preparePublish(input: ListingPublishInput): Promise<{ execute(): Promise<PublishResult> }> {
    this.assertConditionChosen(input);
    const categoryId = this.resolvePublishCategory(input);
    this.assertPublishDetails(categoryId);
    const body = this.buildAdvertPayload(input, categoryId);
    const request = this.createAdvertRequest(body);
    this.http.assertRequestAllowed?.(request);
    return {
      execute: () => this.execute('publish', () => this.sendPreparedAdvert(request), { retry: false }),
    };
  }

  private createAdvertRequest(body: Record<string, unknown>): HttpRequestConfig {
    return {
      method: 'POST',
      url: `${this.baseUrl}/adverts`,
      body,
    };
  }

  private async sendPreparedAdvert(request: HttpRequestConfig): Promise<PublishResult> {
    const res = await this.http.request<
      OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>
    >(request);
    const advert = this.unwrapAdvert(res.data);
    return {
      externalListingId: String(advert.id),
      externalUrl: this.extractPublicUrl(advert),
      publishedAt: new Date(),
      remoteStatus: advert.status ?? null,
      remoteImageUrls: this.extractImageUrls(advert),
    };
  }

  protected async doUpdateListing(
    externalListingId: string,
    changes: Partial<Pick<ListingPublishInput, 'price' | 'description' | 'productName'>>,
    current: ListingPublishInput,
  ): Promise<void> {
    const updated = { ...current, ...changes };
    const categoryId = this.resolvePublishCategory(updated);
    this.assertPublishDetails(categoryId);
    await this.putAdvert(externalListingId, updated, categoryId, {});
  }

  // PUT replaces the whole advert: without the remote attributes and ad_delivery OLX drops what the seller set.
  // The single write boundary: it reads the advert fresh, writes nothing after an unreadable read, and
  // never replaces an attribute that is set on OLX.
  private async putAdvert(
    externalListingId: string,
    input: ListingPublishInput,
    categoryId: number,
    fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] },
  ): Promise<void> {
    const body = this.buildAdvertPayload(input, categoryId, { configuredDelivery: false });
    const remote = await this.fetchRemoteAdvertState(externalListingId);
    const setRemotely = new Set(remote.attributes.filter(isSetAttribute).map((attribute) => attribute.code));
    const attributes = mergeAdvertAttributes(remote.attributes, [
      ...((body.attributes as OlxAttribute[] | undefined) ?? []),
      ...(fields.attributes ?? []).filter((attribute) => !setRemotely.has(attribute.code)),
    ]);
    if (attributes.length > 0) body.attributes = attributes;
    const packages = fields.deliveryPackageIds ?? remote.deliveryPackageIds;
    if (packages.length > 0) body.ad_delivery = { delivery_package_ids: packages };
    await this.http.request({
      method: 'PUT',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
      body,
    });
  }

  updateAdvertFields(
    externalListingId: string,
    current: ListingPublishInput,
    fields: { attributes?: AdvertAttribute[]; deliveryPackageIds?: string[] },
  ): Promise<void> {
    return this.execute('updateAdvertFields', async () => {
      const categoryId = this.resolvePublishCategory(current);
      this.assertPublishDetails(categoryId);
      await this.putAdvert(externalListingId, current, categoryId, fields);
    });
  }

  categorySuggestions(title: string): Promise<string[]> {
    return this.execute('categorySuggestions', async () => {
      const res = await this.http.request<unknown>({
        method: 'GET',
        url: `${this.baseUrl}/categories/suggestion`,
        query: { q: title },
      });
      const items = this.unwrapList(res.data);
      const ids: string[] = [];
      for (const item of items) {
        const id = (item as { id?: unknown } | null)?.id;
        if (typeof id === 'number' || (typeof id === 'string' && id !== '')) ids.push(String(id));
      }
      return ids;
    });
  }

  categoryAttributes(categoryId: string): Promise<OlxCategoryAttribute[]> {
    return this.execute('categoryAttributes', async () => {
      const res = await this.http.request<unknown>({
        method: 'GET',
        url: `${this.baseUrl}/categories/${encodeURIComponent(categoryId)}/attributes`,
      });
      const attributes: OlxCategoryAttribute[] = [];
      for (const raw of this.unwrapList(res.data)) {
        const item = raw as {
          code?: unknown;
          label?: unknown;
          validation?: { required?: unknown; allow_multiple_values?: unknown } | null;
          values?: unknown;
        } | null;
        if (!item || typeof item.code !== 'string') continue;
        const values = Array.isArray(item.values)
          ? item.values.flatMap((v: { code?: unknown; label?: unknown } | null) =>
              v && typeof v.code === 'string'
                ? [{ code: v.code, label: typeof v.label === 'string' ? v.label : v.code }]
                : [],
            )
          : [];
        attributes.push({
          code: item.code,
          label: typeof item.label === 'string' ? item.label : item.code,
          required: item.validation?.required === true,
          multiple: item.validation?.allow_multiple_values === true,
          values,
        });
      }
      return attributes;
    });
  }

  advertFields(
    externalListingId: string,
  ): Promise<{ categoryId: string; attributes: AdvertAttribute[]; deliveryPackageIds: string[] }> {
    return this.execute('advertFields', async () => {
      const remote = await this.fetchRemoteAdvertState(externalListingId);
      const categoryId =
        remote.categoryId ??
        (this.onStubTransport ? (stubAdvertCategories.get(externalListingId) ?? STUB_DEFAULT_CATEGORY_ID) : null);
      if (categoryId === null) throw new Error(`OLX advert ${externalListingId} has no category`);
      return {
        categoryId,
        // A multi-value attribute has no string `value`; it is passed on with its values joined so the checks count it as set and never fill it.
        attributes: remote.attributes.map((attribute) => ({
          code: attribute.code,
          value: isScalar(attribute.value)
            ? String(attribute.value)
            : (attribute.values ?? []).filter(isScalar).map(String).join(','),
        })),
        deliveryPackageIds: remote.deliveryPackageIds.map(String),
      };
    });
  }

  private unwrapList(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    const inner = (data as { data?: unknown } | null)?.data;
    return Array.isArray(inner) ? inner : [];
  }

  // An advert read without an advert id is unreadable: it throws, so nothing is written after it.
  private async fetchRemoteAdvertState(externalListingId: string): Promise<{
    attributes: OlxAttribute[];
    deliveryPackageIds: Array<string | number>;
    categoryId: string | null;
  }> {
    const res = await this.http.request<unknown>({
      method: 'GET',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
    });
    const unwrapped =
      res.data && typeof res.data === 'object'
        ? (this.unwrapAdvert(res.data as OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>) as unknown)
        : null;
    const advert = unwrapped && typeof unwrapped === 'object' ? (unwrapped as OlxAdvertResponse) : null;
    if (!advert || !isScalar(advert.id) || String(advert.id) === '') {
      throw new Error(`OLX returned an unreadable advert ${externalListingId}`);
    }
    const ids = advert.ad_delivery?.delivery_package_ids;
    const rawAttributes = advert.attributes;
    return {
      categoryId: this.categoryId(advert) ?? null,
      attributes: Array.isArray(rawAttributes)
        ? rawAttributes.filter(
            (a): a is OlxAttribute => !!a && typeof a === 'object' && typeof (a as OlxAttribute).code === 'string',
          )
        : [],
      deliveryPackageIds: Array.isArray(ids)
        ? ids.filter((id): id is string | number => (typeof id === 'string' && id !== '') || typeof id === 'number')
        : [],
    };
  }

  private buildAdvertPayload(
    input: ListingPublishInput,
    categoryId: number,
    { configuredDelivery = true }: { configuredDelivery?: boolean } = {},
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      title: input.productName,
      description: input.description,
      category_id: categoryId,
      advertiser_type: this.config.advertiserType ?? 'private',
      price: {
        value: input.price,
        currency: input.currency,
        negotiable: this.config.priceNegotiable ?? false,
      },
      images: input.imageUrls.map((url) => ({ url: this.publicImageUrl(url) })),
    };
    if (this.config.cityId) {
      body.location = {
        city_id: this.config.cityId,
        ...(this.config.districtId ? { district_id: this.config.districtId } : {}),
      };
    }
    if (this.config.contactName) {
      body.contact = {
        name: this.config.contactName,
        ...(this.config.contactPhone ? { phone: this.config.contactPhone } : {}),
      };
    }
    const attributes: Array<{ code: string; value: string }> = [];
    if (this.config.conditionAttributeCode) {
      attributes.push({
        code: this.config.conditionAttributeCode,
        value: this.mapCondition(input.condition),
      });
    }
    if (configuredDelivery && this.config.deliveryAttributeCode && this.config.deliveryOptionCode) {
      attributes.push({
        code: this.config.deliveryAttributeCode,
        value: this.config.deliveryOptionCode,
      });
    }
    if (attributes.length > 0) body.attributes = attributes;
    return body;
  }

  // OLX fetches advert images itself, so an image stored as a root-relative path
  // (an upload) is sent as an absolute URL on the public base URL. Absolute URLs
  // pass through unchanged.
  private publicImageUrl(url: string): string {
    if (!this.publicBaseUrl || !url.startsWith('/') || url.startsWith('//')) return url;
    return `${this.publicBaseUrl}${url}`;
  }

  protected async doDelist(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `${this.baseUrl}/adverts/${externalListingId}`,
    });
  }

  // OLX Partner API: POST /adverts/{id}/commands { command: 'activate' } answers 204. The advert's
  // status (active, new for moderation, limited when a paid packet is needed) is read separately.
  protected async doReactivate(externalListingId: string): Promise<void> {
    await this.http.request({
      method: 'POST',
      url: `${this.baseUrl}/adverts/${externalListingId}/commands`,
      body: { command: 'activate' },
    });
  }

  protected async doSync(externalListingIds: string[]): Promise<SyncedListing[]> {
    return this.mapWithConcurrency(externalListingIds, 5, async (id) => {
      try {
        const res = await this.http.request<OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>>({
          method: 'GET', url: `${this.baseUrl}/adverts/${id}`,
        });
        const advert = this.unwrapAdvert(res.data);
        const [statistics, threadMetrics] = await Promise.all([
          this.fetchAdvertStatistics(id),
          this.fetchThreadMetrics(id),
        ]);
        return this.toSyncedListing(this.withStatistics(advert, statistics.data), threadMetrics);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return this.missingSyncedListing(id);
        }
        if (this.isIsolatedAdvertDetailFailure(error)) {
          return this.failedSyncedListing(id, error);
        }
        throw error;
      }
    });
  }

  private isIsolatedAdvertDetailFailure(error: unknown): error is HttpError {
    if (!(error instanceof HttpError)) return false;
    if (error.status === 401 || error.status === 403 || error.status === 408 || error.status === 429) {
      return false;
    }
    if (error.status >= 500) return false;
    return error.status !== 404;
  }

  private failedSyncedListing(externalListingId: string, error: HttpError): SyncedListing {
    return {
      externalListingId,
      status: 'live',
      syncFailure: {
        kind: 'isolated_listing_failure',
        reason: 'provider_rejection',
        note: `OLX advert detail sync failed: HTTP ${error.status}; local listing state was preserved`,
      },
    };
  }

  protected async doFetchListing(
    externalListingId: string,
  ): Promise<SyncedListing | null> {
    try {
      const res = await this.http.request<OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse> | null>({
        method: 'GET', url: `${this.baseUrl}/adverts/${externalListingId}`,
      });
      if (!res.data) return null;
      const advert = this.unwrapAdvert(res.data);
      const [statistics, threadMetrics] = await Promise.all([
        this.fetchAdvertStatistics(externalListingId),
        this.fetchThreadMetrics(externalListingId),
      ]);
      return this.toSyncedListing(this.withStatistics(advert, statistics.data), threadMetrics);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  private missingSyncedListing(externalListingId: string): SyncedListing {
    return {
      externalListingId,
      status: 'expired',
      remoteStatus: 'missing',
      missing: true,
      views: 0,
      watchers: 0,
      conversations: null,
      messages: null,
      messageMetricStatus: 'unavailable',
    };
  }

  protected async doListOwnedListings(
    options: ImportDiscoveryOptions = {},
  ): Promise<ImportedMarketplaceListing[]> {
    const imported: ImportedMarketplaceListing[] = [];
    const pageSize = options.pageSize ?? 100;
    const status = options.statuses?.join(',');
    let page = 1;
    for (;;) {
      const res = await this.http.request<OlxAdvertListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/adverts`,
        query: { page, limit: pageSize, status },
      });
      imported.push(
        ...(await this.mapWithConcurrency(res.data.data, 5, async (advert) => {
          const externalListingId = String(advert.id);
          const [statistics, threadMetrics] = await Promise.all([
            this.fetchAdvertStatistics(externalListingId),
            this.fetchThreadMetrics(externalListingId),
          ]);
          return this.toImportedListing(this.withStatistics(advert, statistics.data), threadMetrics);
        }))
      );
      const lastPage = res.data.meta?.last_page;
      if (lastPage !== undefined ? page >= lastPage : !res.data.links?.next) break;
      page += 1;
    }
    return imported;
  }

  private unwrapAdvert(
    response: OlxAdvertResponse | OlxResponseEnvelope<OlxAdvertResponse>,
  ): OlxAdvertResponse {
    return 'data' in response ? response.data : response;
  }

  private async fetchAdvertStatistics(
    externalListingId: string,
  ): Promise<OlxAdvertStatisticsResult> {
    try {
      const res = await this.http.request<
        OlxAdvertStatisticsResponse | OlxResponseEnvelope<OlxAdvertStatisticsResponse> | null
      >({
        method: 'GET',
        url: `${this.baseUrl}/adverts/${externalListingId}/statistics`,
      });
      if (!res.data) return { status: 'unavailable', data: null };
      return {
        status: 'success',
        data: ('data' in res.data ? res.data.data : res.data) as OlxAdvertStatisticsResponse,
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { status: 'unavailable', data: null };
      }
      return { status: 'error', data: null };
    }
  }

  // Throws on any transport or shape failure; callers decide how to degrade.
  private async paginateThreads(externalListingId: string): Promise<OlxThreadMetadata[]> {
    let offset = 0;
    let pages = 0;
    const result: OlxThreadMetadata[] = [];
    for (;;) {
      if (pages >= OLX_THREAD_MAX_PAGES) {
        throw new Error('OLX thread metadata pagination exceeded the safety limit');
      }
      pages += 1;
      const res = await this.http.request<OlxThreadListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/threads`,
        query: { advert_id: externalListingId, offset, limit: OLX_THREAD_PAGE_SIZE },
      });
      const envelope = Array.isArray(res.data) ? null : res.data;
      const threads = Array.isArray(res.data) ? res.data : envelope?.data;
      if (!Array.isArray(threads)) throw new Error('Malformed OLX thread metadata response');

      for (const thread of threads) {
        if (String(thread.advert_id) === externalListingId) result.push(thread);
      }

      const explicitNext = envelope?.links?.next;
      const currentPage = envelope?.meta?.current_page;
      const lastPage = envelope?.meta?.last_page;
      const hasNext = explicitNext !== undefined
        ? explicitNext !== null && explicitNext !== ''
        : currentPage !== undefined && lastPage !== undefined
          ? currentPage < lastPage
          : threads.length === OLX_THREAD_PAGE_SIZE;
      if (!hasNext) return result;
      if (threads.length === 0) {
        throw new Error('OLX thread metadata pagination did not advance');
      }
      offset += OLX_THREAD_PAGE_SIZE;
    }
  }

  private async fetchThreadMetrics(
    externalListingId: string,
  ): Promise<OlxThreadMetricsResult> {
    let conversations = 0;
    let messages = 0;
    try {
      for (const thread of await this.paginateThreads(externalListingId)) {
        conversations += 1;
        const total = this.parseCounter(thread.total_count);
        if (total !== null) {
          if (!Number.isSafeInteger(messages + total)) {
            throw new Error('OLX thread message count exceeds the safe integer range');
          }
          messages += total;
        }
      }
      return { status: 'success', conversations, messages };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { status: 'unavailable', conversations: null, messages: null };
      }
      return { status: 'error', conversations: null, messages: null };
    }
  }

  listThreads(externalListingId: string): Promise<MarketplaceThread[]> {
    return this.execute('listThreads', async () => {
      const threads: MarketplaceThread[] = [];
      for (const thread of await this.paginateThreads(externalListingId)) {
        const externalThreadId = this.olxId(thread);
        if (externalThreadId === null) continue;
        const buyer = thread.interlocutor_id;
        threads.push({
          externalThreadId,
          externalBuyerId: buyer === undefined || buyer === null || buyer === '' ? null : String(buyer),
          totalCount: this.parseCounter(thread.total_count),
        });
      }
      return threads;
    });
  }

  listThreadMessages(externalThreadId: string): Promise<MarketplaceThreadMessages> {
    return this.execute('listThreadMessages', async () => {
      const res = await this.requestThreadMessages<OlxMessageListResponse>(externalThreadId, { method: 'GET' });
      const raw = Array.isArray(res.data) ? res.data : res.data?.data;
      if (!Array.isArray(raw)) throw new Error('Malformed OLX thread messages response');
      const messages: MarketplaceMessage[] = [];
      for (const message of raw) {
        const direction = message.type === 'received' ? 'buyer' : message.type === 'sent' ? 'seller' : null;
        const externalMessageId = this.olxId(message);
        const sentAt = typeof message.created_at === 'string' ? new Date(message.created_at) : null;
        if (!direction || typeof message.text !== 'string' || externalMessageId === null) continue;
        if (!sentAt || Number.isNaN(sentAt.getTime())) continue;
        messages.push({ externalMessageId, direction, text: message.text, sentAt });
      }
      messages.sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
      return { messages, fetchedCount: raw.length };
    });
  }

  // OLX documents no response body and no idempotency key, so a lost response must never re-send.
  sendThreadMessage(externalThreadId: string, text: string): Promise<{ externalMessageId: string | null }> {
    return this.execute('sendThreadMessage', async () => {
      const res = await this.requestThreadMessages<OlxSendMessageResponse>(externalThreadId, {
        method: 'POST', body: { text },
      });
      const body = res.data;
      const payload = body && typeof body === 'object' && 'data' in body ? body.data : body;
      return { externalMessageId: payload && typeof payload === 'object' ? this.olxId(payload as OlxIdentified) : null };
    }, { retry: false });
  }

  // An empty or dot segment would address a different OLX path once the URL is resolved. A failure
  // body may echo message text and the error message quotes the body, so it is dropped.
  private async requestThreadMessages<T>(
    externalThreadId: string,
    config: Pick<HttpRequestConfig, 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    if (externalThreadId === '' || externalThreadId === '.' || externalThreadId === '..') {
      throw new Error('Invalid OLX thread id');
    }
    const url = `${this.baseUrl}/threads/${encodeURIComponent(externalThreadId)}/messages`;
    try {
      return await this.http.request<T>({ ...config, url });
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(error.status, error.message);
      throw error;
    }
  }

  // OLX prefers `uuid`; `id` is deprecated but still sent by some endpoints.
  private olxId(entity: OlxIdentified): string | null {
    if (typeof entity.uuid === 'string' && entity.uuid !== '') return entity.uuid;
    if (typeof entity.id === 'string' || typeof entity.id === 'number') return String(entity.id);
    return null;
  }

  private withStatistics(
    advert: OlxAdvertResponse,
    statistics: OlxAdvertStatisticsResponse | null,
  ): OlxAdvertResponse {
    return statistics
      ? { ...advert, statistics: { ...advert.statistics, ...statistics } }
      : advert;
  }

  private async toSyncedListing(
    data: OlxAdvertResponse,
    threadMetrics: OlxThreadMetricsResult,
  ): Promise<SyncedListing> {
    const remoteStatus = String(data.status ?? 'unknown').toLowerCase();
    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      status: OLX_STATUS_TO_LOCAL[remoteStatus] ?? 'draft',
      remoteStatus,
      views: this.extractViews(data),
      watchers: this.extractWatchers(data),
      conversations: threadMetrics.status === 'success'
        ? threadMetrics.conversations
        : threadMetrics.status === 'error' ? undefined : null,
      messages: threadMetrics.status === 'success'
        ? threadMetrics.messages
        : threadMetrics.status === 'error' ? undefined : null,
      messageMetricStatus: threadMetrics.status === 'success' ? 'available' : threadMetrics.status,
      marketplaceCategory: await this.extractMarketplaceCategory(data),
    };
  }

  private async toImportedListing(
    data: OlxAdvertResponse,
    threadMetrics: OlxThreadMetricsResult,
  ): Promise<ImportedMarketplaceListing> {
    const price = this.extractPrice(data.price);
    const views = this.extractViews(data);
    const watchers = this.extractWatchers(data);
    const marketplaceCategory = await this.extractMarketplaceCategory(data);

    return {
      externalListingId: String(data.id),
      externalUrl: this.extractPublicUrl(data),
      title: data.title?.trim() || `OLX advert ${data.id}`,
      description: data.description ?? null,
      price: price.value,
      currency: price.currency,
      status: OLX_STATUS_TO_LOCAL[String(data.status ?? 'unknown').toLowerCase()] ?? 'draft',
      remoteStatus: data.status,
      category: this.extractCategoryName(data, marketplaceCategory),
      marketplaceCategory,
      imageUrls: this.extractImageUrls(data),
      remoteUpdatedAt: data.updated_at ? new Date(data.updated_at) : null,
      metrics: {
        views: views ?? undefined,
        watchers: watchers ?? undefined,
        conversations: threadMetrics.status === 'success'
          ? threadMetrics.conversations
          : threadMetrics.status === 'error' ? undefined : null,
        messages: threadMetrics.status === 'success'
          ? threadMetrics.messages
          : threadMetrics.status === 'error' ? undefined : null,
      },
    };
  }

  private extractPublicUrl(data: OlxAdvertResponse): string | null {
    for (const candidate of [data.url, data.public_url, data.external_url]) {
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:') continue;
        if (!/(^|\.)olx\.pl$/i.test(parsed.hostname)) continue;
        return parsed.toString();
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  private extractPrice(price: OlxAdvertResponse['price']): { value: number | null; currency: string | null } {
    if (typeof price === 'number') return { value: price, currency: null };
    if (typeof price === 'string') {
      const parsed = price.trim() === '' ? Number.NaN : Number(price);
      return { value: Number.isFinite(parsed) ? parsed : null, currency: null };
    }
    if (!price) return { value: null, currency: null };
    const parsed =
      typeof price.value === 'string'
        ? price.value.trim() === ''
          ? Number.NaN
          : Number(price.value)
        : price.value;
    return {
      value: Number.isFinite(parsed) ? parsed ?? null : null,
      currency: price.currency ?? null,
    };
  }

  private extractImageUrls(data: OlxAdvertResponse): string[] {
    return [...(data.photos ?? []), ...(data.images ?? [])].flatMap((image) =>
      image.url ? [image.url] : []
    );
  }

  private extractCounter(data: OlxAdvertResponse, keys: string[]): number | null {
    for (const source of [data.statistics, data.metrics, data.stats, data.counters, data]) {
      if (!source) continue;
      for (const key of keys) {
        const value = (source as Record<string, unknown>)[key];
        const parsed = this.parseCounter(value);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  }

  private extractViews(data: OlxAdvertResponse): number | null {
    return this.extractCounter(data, ['views', 'view_count', 'views_count', 'advert_views', 'page_views']);
  }

  private extractWatchers(data: OlxAdvertResponse): number | null {
    return this.extractCounter(data, [
      'favorites',
      'favourites',
      'watchers',
      'favorite_count',
      'favourite_count',
      'favorites_count',
      'favourites_count',
      'observed_count',
      'users_observing',
    ]);
  }


  private parseCounter(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }


  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let index = 0; index < items.length; index += limit) {
      const batch = items.slice(index, index + limit);
      results.push(...(await Promise.all(batch.map(mapper))));
    }
    return results;
  }

  private assertPublishDetails(categoryId: number | undefined): asserts categoryId is number {
    if (!this.config.requirePublishDetails) return;
    if (!categoryId) throw new Error('OLX category id is required for live publish');
    if (!this.config.cityId) throw new Error('OLX city id is required for live publish');
    if (!this.config.contactName?.trim()) {
      throw new Error('OLX contact name is required for live publish');
    }
  }

  private resolvePublishCategory(input: ListingPublishInput): number | undefined {
    if (this.config.requirePublishDetails) {
      const decision = evaluateOlxCategory({
        name: input.productName, description: input.description, category: input.category,
      }, input.marketplaceCategory ?? null, undefined, { realOlx: true });
      if (!decision.allowed) throw new Error(decision.message ?? 'OLX category validation failed');
      const exact = input.marketplaceCategory!;
      const id = Number(exact.providerCategoryId);
      return Number.isSafeInteger(id) && id > 0 ? id : undefined;
    }
    return input.marketplaceCategory
      ? Number(input.marketplaceCategory.providerCategoryId)
      : this.mapCategory(input.category);
  }

  private extractCategoryName(
    data: OlxAdvertResponse,
    marketplaceCategory: MarketplaceCategoryMetadata | null | undefined,
  ): string | null {
    if (typeof data.category === 'string') return data.category;
    return data.category?.name ?? marketplaceCategory?.name ?? null;
  }

  private categoryId(data: OlxAdvertResponse): string | null | undefined {
    if (data.category_id !== undefined) {
      return data.category_id === null || data.category_id === '' ? null : String(data.category_id);
    }
    // An advert without a category key carries no category evidence at all.
    if (data.category === undefined) return undefined;
    if (!data.category || typeof data.category === 'string' || data.category.id === undefined) return null;
    return String(data.category.id);
  }

  private async extractMarketplaceCategory(data: OlxAdvertResponse) {
    const categoryId = this.categoryId(data);
    if (categoryId === undefined || categoryId === null) return categoryId;
    try {
      return await this.taxonomy.verify(categoryId);
    } catch {
      // Advert payloads do not attest taxonomy path, leafness, confidence, or freshness.
      // Resolver failure is transient/unknown: preserve previously verified sync metadata.
      // Null remains reserved for provider-declared absence or invalid category data.
      return undefined;
    }
  }

  private mapCategory(domainCategory: string): number | undefined {
    const key = domainCategory.toLowerCase();
    return (
      this.config.categoryIds?.[key] ??
      this.config.defaultCategoryId ??
      (this.config.requirePublishDetails ? undefined : STUB_CATEGORY_MAP[key] ?? STUB_CATEGORY_MAP.electronics)
    );
  }

  // Create-only: an update of a live advert keeps working for a product whose condition is still unknown.
  private assertConditionChosen(input: ListingPublishInput): void {
    if (input.condition.toLowerCase() === 'unknown') {
      throw new ValidationError(OLX_CONDITION_REQUIRED_MESSAGE);
    }
  }

  private mapCondition(domainCondition: string): string {
    return OLX_CONDITION_MAP[domainCondition.toLowerCase()] ?? 'used';
  }

  private static stubResponder: StubResponder = (config): HttpResponse => {
    const threadMessages = config.url.match(/\/threads\/([^/?]+)\/messages$/);
    if (threadMessages) {
      const threadUuid = decodeURIComponent(threadMessages[1]);
      const known = sandboxThreadMessages(threadUuid);
      if (!known) return { status: 404, data: {} };
      if (config.method === 'POST') {
        const text = (config.body as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string') return { status: 400, data: {} };
        return { status: 200, data: { data: { uuid: appendSandboxSellerMessage(threadUuid, text) } } };
      }
      return { status: 200, data: [...known] };
    }
    if (config.method === 'GET' && config.url.endsWith('/categories/suggestion')) {
      const title = String(config.query?.q ?? '').toLowerCase();
      return {
        status: 200,
        data: { data: [{ id: title.includes('projektor') ? STUB_PROJECTOR_CATEGORY_ID : STUB_DEFAULT_CATEGORY_ID }] },
      };
    }
    if (config.method === 'GET' && /\/categories\/[^/?]+\/attributes$/.test(config.url)) {
      return {
        status: 200,
        data: {
          data: STUB_CATEGORY_ATTRIBUTES.map((a) => ({
            code: a.code,
            label: a.label,
            validation: { required: a.required, allow_multiple_values: a.multiple },
            values: a.values,
          })),
        },
      };
    }
    const idMatch = config.url.match(/\/adverts\/([^/?]+)/);
    // The random part keeps two publishes in one millisecond apart, so they never share metrics.
    const externalId = idMatch ? idMatch[1] : `olx-${Date.now()}-${randomUUID().slice(0, 8)}`;
    // Sandbox adverts have no OLX page, so the stub never returns a public URL.
    if (config.method === 'POST') {
      return { status: 201, data: { id: externalId, status: 'active' } };
    }
    if (config.method === 'PUT') {
      const body = (config.body ?? {}) as {
        category_id?: number | string;
        attributes?: OlxAttribute[];
        ad_delivery?: { delivery_package_ids?: string[] };
      };
      if (body.category_id !== undefined) stubAdvertCategories.set(externalId, String(body.category_id));
      stubAdverts.set(externalId, {
        attributes: body.attributes ?? [],
        deliveryPackageIds: body.ad_delivery?.delivery_package_ids ?? [],
      });
      return { status: 204, data: {} };
    }
    if (config.method === 'DELETE') {
      return { status: 204, data: {} };
    }
    if (config.method === 'GET' && config.url.endsWith('/threads')) {
      const advert = config.query?.advert_id;
      return { status: 200, data: advert === undefined ? [] : sandboxThreadsForAdvert(String(advert)) };
    }
    if (config.method === 'GET' && config.url.endsWith('/statistics')) {
      // Statistics repeat the counts of the latest advert read without adding a read.
      const reads = stubAdvertReads.get(externalId) ?? 0;
      return {
        status: 200,
        data: {
          advert_views: reads * STUB_VIEWS_PER_READ,
          users_observing: reads * STUB_FAVORITES_PER_READ,
        },
      };
    }
    if (config.method === 'GET' && config.url.endsWith('/adverts')) {
      return {
        status: 200,
        data: {
          data: [
            {
              id: 'olx-demo',
              status: 'active',
              title: 'Demo OLX advert',
              metrics: { views: 0, favorites: 0, messages: 0 },
            },
          ],
          meta: { last_page: 1 },
        },
      };
    }
    // Only a read of a named advert grows its counts, so other requests add no key.
    const advertId = idMatch?.[1];
    const reads = advertId ? (stubAdvertReads.get(advertId) ?? 0) + 1 : 0;
    if (advertId) stubAdvertReads.set(advertId, reads);
    const stored = stubAdverts.get(externalId);
    return {
      status: 200,
      data: {
        id: externalId,
        status: 'active',
        attributes: stored?.attributes ?? STUB_ADVERT_DEFAULT_ATTRIBUTES,
        ad_delivery: { delivery_package_ids: stored?.deliveryPackageIds ?? [] },
        metrics: {
          views: reads * STUB_VIEWS_PER_READ,
          favorites: reads * STUB_FAVORITES_PER_READ,
          messages: 0,
        },
      },
    };
  };
}
