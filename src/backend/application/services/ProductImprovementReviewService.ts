import type { ProductImprovementDecision, ProductImprovementReviewSession, ProductImprovementSuggestions } from '../../../shared/types';
import type { Product } from '../../domain/entities/Product';
import type { Listing } from '../../domain/entities/Listing';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import type { ProductAssistanceGraph } from './ProductAssistanceGraph';

export interface ReviewScope { workspaceId: string; productId: string; listingId?: string }
export interface ReviewTransaction {
  product(scope: ReviewScope): Promise<Product | null>;
  listing(scope: ReviewScope): Promise<Listing | null>;
  latest(scope: ReviewScope): Promise<ProductImprovementReviewSession | null>;
  save(scope: ReviewScope, session: ProductImprovementReviewSession): Promise<void>;
  saveProduct(product: Product): Promise<void>;
  saveListing(listing: Listing, oldPrice: number): Promise<void>;
  audit(scope: ReviewScope, actorId: string, session: ProductImprovementReviewSession, action: string, proposalId?: string, allowBelowCost?: boolean): Promise<void>;
}
export interface ImprovementReviewStore {
  read(scope: ReviewScope): Promise<ProductImprovementReviewSession | null>;
  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T>;
}

export class ProductImprovementReviewService {
  constructor(
    private readonly graph: Pick<ProductAssistanceGraph, 'proposeImprovements'>,
    private readonly store: ImprovementReviewStore,
    private readonly id: () => string,
  ) {}

  read(scope: ReviewScope): Promise<ProductImprovementReviewSession | null> { return this.store.read(scope); }

  async propose(scope: ReviewScope, actorId: string): Promise<ProductImprovementSuggestions> {
    if (!actorId?.trim()) throw new ValidationError('Seller actor is required');
    const before = await this.store.read(scope);
    const result = await this.graph.proposeImprovements(scope);
    const session = await this.store.transaction(async (tx) => {
      const { product, listing } = await this.load(tx, scope);
      if (!result.currency) throw new ValidationError('Improvement generation currency is required');
      this.assertVersions(result, product, listing);
      const current = await tx.latest(scope);
      if (current?.sessionId !== before?.sessionId || current?.revision !== before?.revision) {
        throw new ConflictError('Improvement review changed while generating; reload and retry');
      }
      const now = new Date().toISOString();
      const next: ProductImprovementReviewSession = {
        currency: result.currency, graphVersion: result.graphVersion, sessionId: this.id(), revision: 1, productId: scope.productId,
        ...(scope.listingId ? { listingId: scope.listingId } : {}),
        productUpdatedAt: result.productUpdatedAt,
        ...(result.listingUpdatedAt ? { listingUpdatedAt: result.listingUpdatedAt } : {}),
        createdAt: now, updatedAt: now,
        proposals: [
          ...result.copy.map((copy) => ({ proposalId: this.id(), field: copy.field, proposedValue: copy.proposedValue, rationale: copy.rationale, status: 'pending' as const })),
          ...(result.price ? [{ proposalId: this.id(), field: 'price' as const, proposedValue: result.price.suggestedPrice, rationale: result.price.reasoning, status: 'pending' as const }] : []),
        ],
      };
      await tx.save(scope, next);
      await tx.audit(scope, actorId, next, 'product.improvements_proposed');
      return next;
    });
    return { ...result, session };
  }

  async decide(scope: ReviewScope, sessionId: string, decision: ProductImprovementDecision, actorId: string): Promise<ProductImprovementReviewSession> {
    if (!actorId?.trim()) throw new ValidationError('Seller actor is required');
    return this.store.transaction(async (tx) => {
      const { product, listing } = await this.load(tx, scope);
      const session = await tx.latest(scope);
      if (!session || session.sessionId !== sessionId) throw new NotFoundError('Improvement session not found');
      if (session.revision !== decision.revision) throw new ConflictError('Improvement review changed; reload');
      const proposal = session.proposals.find((entry) => entry.proposalId === decision.proposalId);
      if (!proposal) throw new NotFoundError('Improvement proposal not found');
      if (proposal.status !== 'pending') throw new ConflictError('Proposal already decided');
      if (decision.action === 'accept') {
        this.assertVersions(session, product, listing);
        const value = decision.editedValue ?? proposal.proposedValue;
        if (proposal.field === 'price') {
          if (!listing || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ValidationError('A positive listing price is required');
          const money = Money.of(value, product.sellingPrice.currency);
          if (money.isErr()) throw money.error;
          if (money.value.amount <= 0 || money.value.amount > 99999999.99 || !Number.isSafeInteger(money.value.minorUnits)) throw new ValidationError('Listing price is outside the supported range');
          if (product.costPrice?.isGreaterThan(money.value) && !decision.allowBelowCost) throw new ValidationError('Selling below cost requires explicit confirmation');
          const oldPrice = listing.price.amount;
          const changed = listing.updatePrice(money.value);
          if (changed.isErr()) throw changed.error;
          await tx.saveListing(listing, oldPrice);
          proposal.editedValue = listing.price.amount;
        } else {
          if (typeof value !== 'string') throw new ValidationError('Copy must be text');
          if (proposal.field === 'title' && Array.from(value.trim()).length > 255) throw new ValidationError('Product title must be at most 255 characters');
          const changed = proposal.field === 'title' ? product.rename(value) : product.updateDescription(value);
          if (changed.isErr()) throw changed.error;
          await tx.saveProduct(product);
          proposal.editedValue = proposal.field === 'title' ? product.name : product.description;
        }
        // Following decisions remain valid after changes owned by this review only.
        const persistedProduct = await tx.product(scope);
        const persistedListing = listing ? await tx.listing(scope) : null;
        session.productUpdatedAt = persistedProduct!.updatedAt.toISOString();
        if (persistedListing) session.listingUpdatedAt = persistedListing.updatedAt.toISOString();
      }
      proposal.status = decision.action === 'accept' ? 'accepted' : 'rejected';
      proposal.decidedAt = new Date().toISOString();
      session.updatedAt = proposal.decidedAt;
      session.revision += 1;
      await tx.save(scope, session);
      await tx.audit(scope, actorId, session, `product.improvement_${proposal.status}`, proposal.proposalId, decision.allowBelowCost);
      return session;
    });
  }

  private async load(tx: ReviewTransaction, scope: ReviewScope): Promise<{ product: Product; listing: Listing | null }> {
    const product = await tx.product(scope);
    if (!product) throw new NotFoundError('Product not found');
    const listing = scope.listingId ? await tx.listing(scope) : null;
    if (scope.listingId && (!listing || listing.productId !== product.id)) throw new NotFoundError('Listing not found for product');
    return { product, listing };
  }

  private assertVersions(snapshot: { currency?: string; productUpdatedAt: string; listingUpdatedAt?: string }, product: Product, listing: Listing | null): void {
    if (snapshot.currency !== product.sellingPrice.currency || snapshot.productUpdatedAt !== product.updatedAt.toISOString() || snapshot.listingUpdatedAt !== listing?.updatedAt.toISOString()) {
      throw new ConflictError('Product or listing changed; generate a fresh review');
    }
  }
}
