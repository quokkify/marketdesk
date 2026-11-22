// Thin HTTP adapter for product resources. Parses the request, derives the tenant
// (workspaceId) from the authenticated principal, delegates to the application
// service, and translates the Result via ResponseFormatter. No business logic here.

import type { Request, Response, NextFunction } from 'express';
import { dismissedAfterEdit, researchChangedSince, withNormalizedAutoUrls } from '../../../domain/services/priceResearchEdit';
import type { ProductApplicationService } from '../../../application/services/ProductApplicationService';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { ProductAIDraftService } from '../../../application/services/ProductAIDraftService';
import type { ProductRecheckService } from '../../../application/services/ProductRecheckService';
import type { SaleVerdictRuns } from '../../../application/services/verdict/SaleVerdictRuns';
import type { ProductAssistanceGraph } from '../../../application/services/ProductAssistanceGraph';
import { SEARCH_CURRENCY, SEARCH_NEEDS_PLN, SEARCH_NOT_CONFIGURED } from '../../../application/services/PriceResearchGraph';
import type { IPriceResearchRuns } from '../../../domain/ports/IPriceResearchRuns';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IPriceResearchRepository } from '../../../domain/repositories/interfaces/IPriceResearchRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { CreateProductDTO } from '../../../application/dto/CreateProductDTO';
import type { UpdateProductDTO } from '../../../application/dto/UpdateProductDTO';
import type { ListProductsQueryDTO, SortKey } from '../../../application/dto/ListProductsQueryDTO';
import { priceReadiness } from '../../../domain/services/priceReadiness';
import type { PriceResearch, PriceResearchView, ProductStatus } from '../../../../shared/types';
import { ConflictError, InvalidStateError, NotFoundError, ServiceUnavailableError } from '../../../domain/shared/DomainError';
import { Listing } from '../../../domain/entities/Listing';
import { Money } from '../../../domain/valueObjects/Money';
import { ok, created, paginated } from '../formatters/ResponseFormatter';
import { presentListing } from '../../../application/dto/presenters';
import type { ProductStatsService } from '../../../application/services/ProductStatsService';

// A product with a run but no stored research yet.
const EMPTY_RESEARCH = (productId: string): Omit<PriceResearch, 'updatedAt'> => ({
  productId, retailPrice: null, retailCurrency: null, retailSource: null, retailCheckedAt: null,
  comparables: [], specs: null, dismissedUrls: [], lastAttemptAt: null, lastEstimate: null,
});

const RESEARCH_CHANGED = 'Price research changed since you opened it. Reload and try again.';

// The validated PUT body: the editable research plus the updatedAt the client's form was built from.
type PriceResearchPutBody = Pick<PriceResearch, 'retailPrice' | 'retailCurrency' | 'retailSource' | 'retailCheckedAt' | 'comparables'> & {
  baseUpdatedAt?: string | null;
};

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseStringList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        const values = parsed.map((entry) => entry.trim()).filter(Boolean);
        return values.length ? values : undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  return csv(value);
}

function num(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseSort(value: unknown): SortKey[] | undefined {
  const tokens = csv(value);
  if (!tokens) return undefined;
  return tokens.map((token) => {
    if (token.startsWith('-')) return { field: token.slice(1), dir: 'desc' as const };
    if (token.startsWith('+')) return { field: token.slice(1), dir: 'asc' as const };
    return { field: token, dir: 'asc' as const };
  });
}

function isUniqueListingConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const pgError = err as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'unique_listing';
}

export class ProductController {
  constructor(
    private readonly products: ProductApplicationService,
    private readonly listings: ListingApplicationService,
    private readonly productAIDrafts: ProductAIDraftService,
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly idGenerator: () => string,
    private readonly productRecheck?: ProductRecheckService,
    private readonly assistance?: ProductAssistanceGraph,
    private readonly priceResearchRepo?: IPriceResearchRepository,
    private readonly researchRuns?: IPriceResearchRuns,
    private readonly productStats?: ProductStatsService,
    private readonly saleVerdictRuns?: SaleVerdictRuns,
    // Whether a research profile is configured.
    private readonly researchConfigured = false,
  ) {}

  stats = async (req: Request, res: Response): Promise<void> => {
    if (!this.productStats) throw new ServiceUnavailableError('Product statistics are unavailable');
    ok(res, { byProductId: await this.productStats.statsByProduct(req.user!.workspaceId!) });
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const query: ListProductsQueryDTO = {
      workspaceId: req.user!.workspaceId!,
      status: csv(req.query.status) as ProductStatus[] | undefined,
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      tags: parseStringList(req.query.tags),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sort: parseSort(req.query.sort),
      needsAction: req.query.needsAction === 'true' ? true : undefined,
      limit: num(req.query.limit),
      offset: num(req.query.offset),
    };
    const needsStats =
      query.needsAction ||
      query.sort?.some((key) => key.field === 'views' || key.field === 'viewsDelta7d');
    const stats =
      needsStats && this.productStats
        ? await this.productStats.statsByProduct(query.workspaceId)
        : undefined;
    const result = await this.products.listProducts(query, stats);
    if (result.isErr()) return next(result.error);
    const page = result.value;
    const verdicts = this.saleVerdictRuns
      ? await this.saleVerdictRuns.viewsFor(query.workspaceId, page.items.map((item) => item.id))
      : undefined;
    const items = verdicts
      ? page.items.map((item) => ({
          ...item,
          verdict: verdicts.latest.get(item.id) ?? null,
          verdictLastFailed: verdicts.failed.has(item.id),
        }))
      : page.items;
    paginated(res, items, {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: page.totalPages,
    });
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const product = await this.products.getProduct(productId, req.user!.workspaceId!);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    ok(res, product);
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const dto: CreateProductDTO = { ...req.body, workspaceId: req.user!.workspaceId! };
    const result = await this.products.createProduct(dto);
    if (result.isErr()) return next(result.error);
    created(res, result.value);
  };

  generateAIDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (this.assistance) {
      try {
        ok(res, await this.assistance.generateDraft(req.user!.workspaceId!, req.body));
      } catch (error) { next(error); }
      return;
    }
    const result = await this.productAIDrafts.generateDraft({
      ...req.body,
      workspaceId: req.user!.workspaceId!,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    // workspaceId comes from the authenticated principal, never the body (S2).
    const dto: UpdateProductDTO = {
      ...req.body,
      productId,
      workspaceId: req.user!.workspaceId!,
    };
    const result = await this.products.updateProduct(dto);
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  recheck = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.productRecheck) throw new ServiceUnavailableError('Product recheck is unavailable');
      const request = {
        productId: routeParam(req.params.id),
        listingId: String(req.body?.listingId ?? ''),
        workspaceId: req.user!.workspaceId!,
        actorId: req.user!.userId,
      };
      const result = this.saleVerdictRuns
        ? await this.saleVerdictRuns.recheckInfo(request.workspaceId, request.productId, request.listingId, request.actorId)
        : await this.productRecheck.recheck(request);
      ok(res, result);
    } catch (error) {
      next(error);
    }
  };

  getPriceResearch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const productId = routeParam(req.params.id);
      const workspaceId = req.user!.workspaceId!;
      await this.requireProduct(productId, workspaceId);
      const research = await this.requirePriceResearchRepo().findByProduct(workspaceId, productId);
      const { active, last } = this.researchRuns
        ? await this.researchRuns.latest(workspaceId, productId)
        : { active: null, last: null };
      if (!research && !active && !last) {
        ok(res, null);
        return;
      }
      const view: PriceResearchView = {
        ...(research ?? EMPTY_RESEARCH(productId)),
        updatedAt: research?.updatedAt ?? null,
        run: active,
        lastRun: last,
        nextAutoAt: last?.nextAutoAt ?? null,
        readiness: priceReadiness({ lastRun: last, research, estimate: research?.lastEstimate ?? null }),
      };
      ok(res, view);
    } catch (error) { next(error); }
  };

  putPriceResearch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const productId = routeParam(req.params.id);
      const workspaceId = req.user!.workspaceId!;
      await this.requireProduct(productId, workspaceId);
      const repo = this.requirePriceResearchRepo();
      const { baseUpdatedAt, ...body } = req.body as PriceResearchPutBody;
      // Under the row lock a research run's save takes, so neither overwrites the other's rows or dismissals.
      const saved = await repo.saveEditLocked(workspaceId, productId, (stored) => {
        if (researchChangedSince(stored?.updatedAt ?? null, baseUpdatedAt)) throw new ConflictError(RESEARCH_CHANGED);
        const comparables = withNormalizedAutoUrls(body.comparables);
        const dismissedUrls = dismissedAfterEdit(stored?.comparables ?? [], comparables, stored?.dismissedUrls ?? []);
        return { ...body, comparables, productId, dismissedUrls };
      });
      ok(res, saved);
    } catch (error) { next(error); }
  };

  // Researches again through the price scope of a sale verdict; the research runs in its job.
  refreshPriceResearch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const productId = routeParam(req.params.id);
      await this.requireProduct(productId, workspaceId);
      if (!this.researchConfigured) throw new ServiceUnavailableError(SEARCH_NOT_CONFIGURED);
      if (!this.saleVerdictRuns) throw new ServiceUnavailableError('Sale verdicts are unavailable');
      const [listing] = await this.listingRepo.findByProduct(productId);
      if (!listing || listing.price.currency !== SEARCH_CURRENCY) throw new InvalidStateError(SEARCH_NEEDS_PLN);
      const { run, enqueued } = await this.saleVerdictRuns.request(workspaceId, productId, ['price'], 'manual', {
        forceResearch: true,
      });
      // The run continues in the background; a run already queued or running is answered as is.
      ok(res, { run }, enqueued ? 202 : 200);
    } catch (error) { next(error); }
  };

  private async requireProduct(productId: string, workspaceId: string): Promise<void> {
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${productId}`);
  }

  private requirePriceResearchRepo(): IPriceResearchRepository {
    if (!this.priceResearchRepo) throw new ServiceUnavailableError('Price research is unavailable');
    return this.priceResearchRepo;
  }

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.products.deleteProduct(
      routeParam(req.params.id),
      req.user!.workspaceId!
    );
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  createListing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));

    const marketplace = await this.marketplaceRepo.findByKey(
      workspaceId,
      req.body.marketplaceKey ?? 'olx'
    );
    if (!marketplace || !marketplace.isConnected()) {
      return next(new NotFoundError(`Marketplace not found: ${req.body.marketplaceKey ?? 'olx'}`));
    }

    const existing = (await this.listingRepo.findByProduct(productId)).find(
      (listing) => listing.marketplaceId === marketplace.id
    );
    if (existing) {
      return next(new ConflictError(`Listing already exists for marketplace: ${marketplace.key}`));
    }

    const money = Money.of(
      req.body.price ?? product.sellingPrice.amount,
      product.sellingPrice.currency
    );
    if (money.isErr()) return next(money.error);
    const listing = Listing.create({
      id: this.idGenerator(),
      productId: product.id,
      marketplaceId: marketplace.id,
      price: money.value,
    });
    if (listing.isErr()) return next(listing.error);

    try {
      await this.listingRepo.save(listing.value);
    } catch (err) {
      if (isUniqueListingConflict(err)) {
        return next(
          new ConflictError(`Listing already exists for marketplace: ${marketplace.key}`)
        );
      }
      return next(err);
    }
    created(res, presentListing(listing.value));
  };

  getListings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    // Confirm the product belongs to the caller's workspace before exposing its
    // listings, otherwise a cross-tenant product id would leak listings (S2).
    const product = await this.products.getProduct(productId, workspaceId);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    const listings = await this.listings.listByProduct(productId, workspaceId);
    ok(res, listings);
  };
}
