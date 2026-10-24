// Application service (facade) for product workflows. Groups the create/update use
// cases and exposes paginated read/query methods for controllers (Group 5). Write
// methods return presented views; queries apply §18 filtering + multi-key sorting in
// memory over the workspace's products.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { ConflictError, NotFoundError } from '../../domain/shared/DomainError';
import type { Product } from '../../domain/entities/Product';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IProductImageStorage } from '../ports/IProductImageStorage';
import type { PaginatedResponse } from '../../../shared/types';
import { isUuid } from '../../../shared/validation/identifiers';
import { CreateProductUseCase } from '../usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../usecases/UpdateProductUseCase';
import { PricingValidator } from '../validators/PricingValidator';
import type { CreateProductDTO } from '../dto/CreateProductDTO';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';
import type { ListProductsQueryDTO, SortKey } from '../dto/ListProductsQueryDTO';
import { presentProduct, type ProductView } from '../dto/presenters';
import { normalizeLimit, normalizeOffset, paginate } from '../dto/pagination';

// Upload ids that a product delete removed from storage, or could not remove.
export interface ProductImageCleanup {
  removed: string[];
  failed: string[];
}

export interface ProductDeletion {
  id: string;
  deleted: true;
  imageCleanup: ProductImageCleanup;
}

// Structural, so the container can pass its error logger.
export interface ProductCleanupLogger {
  error(context: Record<string, unknown>, message: string): void;
}

// Uploads are served as /uploads/workspaces/<key>/products/<uuid>.<ext>. Any other
// image URL, such as an OLX CDN photo, is not a stored upload.
const UPLOADED_IMAGE_PATH = /^\/uploads\/workspaces\/[^/]+\/products\/([^/]+)\.(?:jpg|png|webp)$/;

function uploadedImageId(url: string): string | null {
  const id = UPLOADED_IMAGE_PATH.exec(url)?.[1];
  return id && isUuid(id) ? id : null;
}

export class ProductApplicationService {
  private readonly pricingValidator = new PricingValidator();

  constructor(
    private readonly productRepo: IProductRepository,
    private readonly createProductUseCase: CreateProductUseCase,
    private readonly updateProductUseCase: UpdateProductUseCase,
    private readonly listingRepo: IListingRepository,
    private readonly imageStorage?: IProductImageStorage,
    private readonly logger?: ProductCleanupLogger
  ) {}

  async createProduct(dto: CreateProductDTO): Promise<Result<ProductView>> {
    const result = await this.createProductUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentProduct(result.value));
  }

  async updateProduct(dto: UpdateProductDTO): Promise<Result<ProductView>> {
    const result = await this.updateProductUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentProduct(result.value));
  }

  async getProduct(id: string, workspaceId: string): Promise<ProductView | null> {
    // Tenant-scoped so a cross-workspace id reads as not-found (S2).
    const product = await this.productRepo.findByIdForWorkspace(id, workspaceId);
    return product ? presentProduct(product) : null;
  }

  async deleteProduct(id: string, workspaceId: string): Promise<Result<ProductDeletion>> {
    // Tenant-scoped so a cross-workspace id reads as not-found (S2).
    const product = await this.productRepo.findByIdForWorkspace(id, workspaceId);
    if (!product) return Err(new NotFoundError(`Product not found: ${id}`));
    // The delete cascades to the listings, so a live advert would lose its only
    // local record. Draft, delisted, expired and error listings never block,
    // whatever marketplace listing id they still carry.
    const listings = await this.listingRepo.findByProduct(product.id);
    if (listings.some((listing) => listing.isLive())) {
      return Err(new ConflictError('This product is still live on OLX. Unpublish it first.'));
    }
    const unreferencedUploads = await this.uploadsOnlyUsedBy(product);
    await this.productRepo.delete(product.id, workspaceId);
    return Ok({
      id: product.id,
      deleted: true,
      imageCleanup: await this.removeUploads(product.id, workspaceId, unreferencedUploads),
    });
  }

  // Upload ids among the product's images that no other product of the workspace
  // uses. Uploads are workspace-scoped, so other workspaces cannot reference them.
  // Accepted for the MVP: the check reads before the delete, outside its
  // transaction, so an upload attached to another product in between is unlinked.
  private async uploadsOnlyUsedBy(product: Product): Promise<string[]> {
    const uploads = new Set(
      product.images.map(uploadedImageId).filter((imageId): imageId is string => imageId !== null)
    );
    if (!this.imageStorage || uploads.size === 0) return [];
    for (const other of await this.productRepo.findByWorkspace(product.workspaceId)) {
      if (other.id === product.id) continue;
      for (const url of other.images) {
        const imageId = uploadedImageId(url);
        if (imageId) uploads.delete(imageId);
      }
    }
    return [...uploads];
  }

  // Best effort: the product is already deleted, so a failed unlink only leaves an
  // orphaned file. It is logged and reported in the result instead of failing the
  // request.
  private async removeUploads(
    productId: string,
    workspaceId: string,
    imageIds: string[]
  ): Promise<ProductImageCleanup> {
    const cleanup: ProductImageCleanup = { removed: [], failed: [] };
    if (!this.imageStorage) return cleanup;
    for (const imageId of imageIds) {
      try {
        if (await this.imageStorage.delete(workspaceId, imageId)) cleanup.removed.push(imageId);
      } catch (err) {
        cleanup.failed.push(imageId);
        this.logger?.error(
          { productId, imageId, err },
          'Product image cleanup failed after the product delete'
        );
      }
    }
    return cleanup;
  }

  async listProducts(query: ListProductsQueryDTO): Promise<Result<PaginatedResponse<ProductView>>> {
    const validated = this.pricingValidator.validateListQuery(query);
    if (validated.isErr()) return validated;
    const q = validated.value;

    const all = await this.productRepo.findByWorkspace(q.workspaceId);
    const filtered = all.filter((p) => this.matches(p, q));
    const sorted = this.sort(filtered, q.sort);

    const limit = normalizeLimit(q.limit);
    const offset = normalizeOffset(q.offset);
    return Ok(paginate(sorted, offset, limit, presentProduct));
  }

  private matches(product: Product, q: ListProductsQueryDTO): boolean {
    if (q.status && q.status.length > 0 && !q.status.includes(product.status)) {
      return false;
    }
    const price = product.sellingPrice.amount;
    if (q.priceMin !== undefined && price < q.priceMin) return false;
    if (q.priceMax !== undefined && price > q.priceMax) return false;
    if (q.tags && q.tags.length > 0) {
      const has = q.tags.some((t) => product.tags.includes(t));
      if (!has) return false;
    }
    if (q.search) {
      const needle = q.search.toLowerCase();
      const haystack =
        `${product.name} ${product.sku} ${product.description} ${product.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  private sort(products: Product[], sort?: SortKey[]): Product[] {
    if (!sort || sort.length === 0) {
      return [...products].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }
    return [...products].sort((a, b) => {
      for (const key of sort) {
        const cmp = this.compareField(a, b, key.field);
        if (cmp !== 0) return key.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  private compareField(a: Product, b: Product, field: string): number {
    switch (field) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'sku':
        return a.sku.localeCompare(b.sku);
      case 'sellingPrice':
        return a.sellingPrice.minorUnits - b.sellingPrice.minorUnits;
      case 'costPrice':
        return (
          (a.costPrice?.minorUnits ?? Number.POSITIVE_INFINITY) -
          (b.costPrice?.minorUnits ?? Number.POSITIVE_INFINITY)
        );
      case 'status':
        return a.status.localeCompare(b.status);
      case 'createdAt':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'updatedAt':
      default:
        return a.updatedAt.getTime() - b.updatedAt.getTime();
    }
  }
}
