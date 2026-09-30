import type { PoolClient, Pool } from 'pg';
import { randomUUID } from 'crypto';
import { PriceHistoryRepository } from './PriceHistoryRepository';
import type { ProductImprovementReviewSession } from '../../../../shared/types';
import type { ImprovementReviewStore, ReviewScope, ReviewTransaction } from '../../../application/services/ProductImprovementReviewService';
import { query, withTransaction } from '../../../config/database';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { ProductRepository } from './ProductRepository';
import { ListingRepository } from './ListingRepository';

export class PostgresImprovementReviewStore implements ImprovementReviewStore {
  constructor(private readonly pool?: Pool) {}

  private async runTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) return withTransaction(work);
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { releaseError = rollbackError instanceof Error ? rollbackError : new Error('Rollback failed'); }
      throw error;
    } finally { client.release(releaseError); }
  }
  async read(scope: ReviewScope): Promise<ProductImprovementReviewSession | null> {
    const product = await new ProductRepository(this.pool).findByIdForWorkspace(scope.productId, scope.workspaceId);
    if (!product) throw new NotFoundError('Product not found');
    if (scope.listingId) {
      const listing = await new ListingRepository(this.pool).findByIdForWorkspace(scope.listingId, scope.workspaceId);
      if (!listing || listing.productId !== product.id) throw new NotFoundError('Listing not found for product');
    }
    return this.latest(scope);
  }

  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T> {
    return this.runTransaction(async (client) => {
      const products = new ProductRepository(this.pool, client);
      const listings = new ListingRepository(this.pool, client);
      return work({
        product: async (scope) => {
          // Keep currency stable throughout the decision transaction. Compatible
          // shared workspace locks permit unrelated products to progress together.
          await query('SELECT id FROM workspaces WHERE id = $1 FOR SHARE', [scope.workspaceId], client);
          return products.findByIdForWorkspaceForUpdate(scope.productId, scope.workspaceId);
        },
        listing: async (scope) => {
          // All paths lock workspace, product, listing, then review.
          await query(`SELECT id FROM listings WHERE id = $1 AND product_id = $2 FOR UPDATE`, [scope.listingId, scope.productId], client);
          return listings.findByIdForWorkspace(scope.listingId!, scope.workspaceId);
        },
        latest: (scope) => this.latest(scope, client),
        save: async (scope, session) => {
          await query(`INSERT INTO product_improvement_reviews (workspace_id, product_id, listing_scope, session_id, state)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (workspace_id, product_id, listing_scope) DO UPDATE SET session_id = EXCLUDED.session_id, state = EXCLUDED.state`,
          [scope.workspaceId, scope.productId, scope.listingId ?? '', session.sessionId, JSON.stringify(session)], client);
        },
        saveProduct: (product) => products.save(product),
        saveListing: async (listing, oldPrice) => {
          await listings.save(listing);
          await new PriceHistoryRepository(undefined, client).record({
            id: randomUUID(), listingId: listing.id, oldPrice, newPrice: listing.price.amount,
            changedBy: 'user', reason: 'Seller accepted improvement review', createdAt: new Date(),
          });
        },
        audit: async (scope, actorId, session, action, proposalId, allowBelowCost) => {
          await query(`INSERT INTO activity_log (workspace_id, entity_type, entity_id, actor_type, actor_id, action, metadata)
            VALUES ($1, 'Product', $2, 'user', $3, $4, $5::jsonb)`,
          [scope.workspaceId, scope.productId, actorId, action, JSON.stringify({ currency: session.currency, graphVersion: session.graphVersion, sessionId: session.sessionId, revision: session.revision, proposalId, listingId: scope.listingId, allowBelowCost: allowBelowCost === true, proposals: proposalId ? session.proposals.filter((proposal) => proposal.proposalId === proposalId) : session.proposals })], client);
        },
      });
    });
  }

  private async latest(scope: ReviewScope, client?: PoolClient): Promise<ProductImprovementReviewSession | null> {
    const result = await query<{ state: ProductImprovementReviewSession }>(`SELECT state FROM product_improvement_reviews
      WHERE workspace_id = $1 AND product_id = $2 AND listing_scope = $3`, [scope.workspaceId, scope.productId, scope.listingId ?? ''], client ?? this.pool);
    return result.rows[0]?.state ?? null;
  }
}
