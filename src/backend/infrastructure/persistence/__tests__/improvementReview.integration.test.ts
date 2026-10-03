import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { ProductImprovementReviewService, type ImprovementReviewStore, type ReviewScope } from '../../../application/services/ProductImprovementReviewService';
import { PostgresImprovementReviewStore } from '../repositories/ImprovementReviewStore';
import { ProductRepository } from '../repositories/ProductRepository';
import { ListingRepository } from '../repositories/ListingRepository';
import type { ProductImprovementSuggestions } from '../../../../shared/types';

const required = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = process.env.DATABASE_URL || required ? describe : describe.skip;

describeDb('durable improvement review (PostgreSQL)', () => {
  let pool: Pool;
  let store: PostgresImprovementReviewStore;
  let scope: ReviewScope;
  const actor = 'seller-review-test';

  const graph = {
    proposeImprovements: async (input: ReviewScope): Promise<ProductImprovementSuggestions> => {
      const product = await new ProductRepository(pool).findByIdForWorkspace(input.productId, input.workspaceId);
      const listing = input.listingId ? await new ListingRepository(pool).findByIdForWorkspace(input.listingId, input.workspaceId) : null;
      if (!product) throw new Error('Fixture product missing');
      return {
        graphVersion: 'product-assistance@1', currency: product.sellingPrice.currency, productId: input.productId,
        productUpdatedAt: product.updatedAt.toISOString(),
        ...(listing ? { listingUpdatedAt: listing.updatedAt.toISOString() } : {}),
        reviewOnly: true,
        copy: [{ field: 'title', proposedValue: 'Improved seller title', rationale: 'Clearer name' },
          { field: 'description', proposedValue: 'Detailed improved seller description.', rationale: 'More useful details' }],
        ...(listing ? { price: { suggestedPrice: 35, reasoning: 'Adjusted local price', confidence: 'medium' as const } } : {}),
      };
    },
  };
  const service = (customStore: ImprovementReviewStore = store) => new ProductImprovementReviewService(graph, customStore, randomUUID);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(fs.readFileSync(path.resolve('src/backend/persistence/migrations/041_product_improvement_reviews.sql'), 'utf8'));
    store = new PostgresImprovementReviewStore(pool);
  });
  beforeEach(async () => {
    scope = { workspaceId: randomUUID(), productId: randomUUID(), listingId: randomUUID() };
    const marketplaceId = randomUUID();
    await pool.query(`INSERT INTO workspaces (id, name, currency) VALUES ($1,'review test','PLN')`, [scope.workspaceId]);
    await pool.query(`INSERT INTO products (id, workspace_id, sku, name, description, cost_price, selling_price, condition, category)
      VALUES ($1,$2,$3,'Original title','Original detailed product description.',40,50,'new','other')`, [scope.productId, scope.workspaceId, randomUUID()]);
    await pool.query(`INSERT INTO marketplaces (id,workspace_id,key,name) VALUES ($1,$2,'olx','OLX')`, [marketplaceId,scope.workspaceId]);
    await pool.query(`INSERT INTO listings (id,product_id,marketplace_id,price,status) VALUES ($1,$2,$3,50,'draft')`, [scope.listingId,scope.productId,marketplaceId]);
  });
  afterEach(async () => { if (scope) await pool.query('DELETE FROM workspaces WHERE id=$1', [scope.workspaceId]); });
  afterAll(async () => { await pool?.end(); });

  it('restores a saved review with reconstructed service/store and isolates workspaces', async () => {
    const proposed = await service().propose(scope, actor);
    const restored = await service(new PostgresImprovementReviewStore(pool)).read(scope);
    expect(restored).toEqual(proposed.session);
    await expect(service().read({ ...scope, workspaceId: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const unrelated = await service().read({ workspaceId: scope.workspaceId, productId: scope.productId });
    expect(unrelated).toBeNull();
  });

  it('applies seller-edited copy, then permits the next proposal with the refreshed snapshot', async () => {
    const original = (await service().propose(scope, actor)).session!;
    const first = await service().decide(scope, original.sessionId, { revision: 1, proposalId: original.proposals[0].proposalId, action: 'accept', editedValue: 'Seller corrected title' }, actor);
    const second = await service().decide(scope, first.sessionId, { revision: 2, proposalId: first.proposals[1].proposalId, action: 'accept' }, actor);
    expect(second.revision).toBe(3);
    const product = await new ProductRepository(pool).findByIdForWorkspace(scope.productId, scope.workspaceId);
    expect(product!.name).toBe('Seller corrected title');
    expect(second.productUpdatedAt).toBe(product!.updatedAt.toISOString());
    const audits = await pool.query('SELECT metadata FROM activity_log WHERE workspace_id=$1 ORDER BY created_at', [scope.workspaceId]);
    expect(audits.rows.some((row) => row.metadata.proposals[0].editedValue === 'Seller corrected title')).toBe(true);
  });

  it('rejects external stale state, but allows explicit rejection without editing facts', async () => {
    const review = (await service().propose(scope, actor)).session!;
    await pool.query(`UPDATE products SET name='External title', updated_at=updated_at + INTERVAL '1 second' WHERE id=$1`, [scope.productId]);
    await expect(service().decide(scope, review.sessionId, { revision: 1, proposalId: review.proposals[0].proposalId, action: 'accept' }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    const rejected = await service().decide(scope, review.sessionId, { revision: 1, proposalId: review.proposals[0].proposalId, action: 'reject' }, actor);
    expect(rejected.proposals[0].status).toBe('rejected');
    expect((await pool.query('SELECT name FROM products WHERE id=$1', [scope.productId])).rows[0].name).toBe('External title');
  });

  it('serializes concurrent decisions and rejects repeats without another mutation', async () => {
    const review = (await service().propose(scope, actor)).session!;
    const decision = { revision: 1, proposalId: review.proposals[0].proposalId, action: 'accept' as const };
    const outcomes = await Promise.allSettled([service().decide(scope, review.sessionId, decision, actor), service().decide(scope, review.sessionId, decision, actor)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const saved = (await service().read(scope))!;
    await expect(service().decide(scope, review.sessionId, { ...decision, revision: saved.revision }, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service().read(scope))!.revision).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS count FROM activity_log WHERE workspace_id=$1 AND action='product.improvement_accepted'", [scope.workspaceId])).rows[0].count).toBe(1);
  });

  it('requires below-cost confirmation and preserves atomic price history', async () => {
    const review = (await service().propose(scope, actor)).session!;
    const decision = { revision: 1, proposalId: review.proposals[2].proposalId, action: 'accept' as const };
    await expect(service().decide(scope, review.sessionId, decision, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await service().read(scope))!.revision).toBe(1);
    const saved = await service().decide(scope, review.sessionId, { ...decision, allowBelowCost: true }, actor);
    const listing = await new ListingRepository(pool).findByIdForWorkspace(scope.listingId!,scope.workspaceId);
    expect(listing!.price.amount).toBe(35);
    expect(listing!.status).toBe('draft');
    expect(saved.listingUpdatedAt).toBe(listing!.updatedAt.toISOString());
    const history = await pool.query('SELECT old_price, new_price, changed_by FROM price_history WHERE listing_id=$1',[scope.listingId]);
    expect(history.rows).toEqual([{old_price:'50.00',new_price:'35.00',changed_by:'user'}]);
  });

  it('rolls back domain save, review and price history if the audit fails', async () => {
    const review = (await service().propose(scope, actor)).session!;
    const failing: ImprovementReviewStore = { read: (input) => store.read(input), transaction: (work) => store.transaction((tx) => work({ ...tx, audit: async () => { throw new Error('audit unavailable'); } })) };
    await expect(service(failing).decide(scope, review.sessionId, { revision: 1, proposalId: review.proposals[2].proposalId, action: 'accept', editedValue: 45 }, actor)).rejects.toThrow('audit unavailable');
    expect((await service().read(scope))!.revision).toBe(1);
    expect((await pool.query('SELECT price FROM listings WHERE id=$1', [scope.listingId])).rows[0].price).toBe('50.00');
    expect((await pool.query('SELECT count(*)::int AS count FROM price_history WHERE listing_id=$1', [scope.listingId])).rows[0].count).toBe(0);
  });

  it('rejects generation when the product changes during provider work', async () => {
    const changingGraph = { proposeImprovements: async (input: ReviewScope) => {
      const result = await graph.proposeImprovements(input);
      await pool.query("UPDATE listings SET updated_at=updated_at + INTERVAL '1 second' WHERE id=$1", [scope.listingId]);
      return result;
    }};
    await expect(new ProductImprovementReviewService(changingGraph,store,randomUUID).propose(scope,actor)).rejects.toMatchObject({code:'CONFLICT'});
    expect(await service().read(scope)).toBeNull();
  });

  it('prevents concurrent generations from overwriting the winning review', async () => {
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const concurrentGraph = { proposeImprovements: async (input: ReviewScope) => {
      const result = await graph.proposeImprovements(input);
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return result;
    }};
    const concurrentService = new ProductImprovementReviewService(concurrentGraph,store,randomUUID);
    const results = await Promise.allSettled([concurrentService.propose(scope,actor),concurrentService.propose(scope,actor)]);
    expect(results.filter((result) => result.status==='fulfilled')).toHaveLength(1);
    const winner = results.find((result) => result.status==='fulfilled') as PromiseFulfilledResult<ProductImprovementSuggestions>;
    expect(await service().read(scope)).toEqual(winner.value.session);
  });
  it('records normalized accepted values and rejects rounded-zero/oversized prices', async () => {
    const review = (await service().propose(scope, actor)).session!;
    const priceDecision = {revision:1,proposalId:review.proposals[2].proposalId,action:'accept' as const};
    for (const editedValue of [0.001,100000000,Number.MAX_VALUE]) {
      await expect(service().decide(scope,review.sessionId,{...priceDecision,editedValue},actor)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
    }
    const normalized = await service().decide(scope,review.sessionId,{...priceDecision,editedValue:45.555},actor);
    expect(normalized.proposals[2].editedValue).toBe(45.56);
    const title = await service().decide(scope,review.sessionId,{revision:2,proposalId:review.proposals[0].proposalId,action:'accept',editedValue:'  Seller title  '},actor);
    expect(title.proposals[0].editedValue).toBe('Seller title');
  });

  it('invalidates saved reviews and in-flight generation when workspace currency changes', async () => {
    const review = (await service().propose(scope,actor)).session!;
    expect(review.currency).toBe('PLN');
    await pool.query("UPDATE workspaces SET currency='USD' WHERE id=$1",[scope.workspaceId]);
    await expect(service().decide(scope,review.sessionId,{revision:1,proposalId:review.proposals[2].proposalId,action:'accept',allowBelowCost:true},actor)).rejects.toMatchObject({code:'CONFLICT'});
    expect((await service().read(scope))!.revision).toBe(1);
    expect((await pool.query('SELECT price FROM listings WHERE id=$1',[scope.listingId])).rows[0].price).toBe('50.00');
    const changingCurrencyGraph = { proposeImprovements: async(input:ReviewScope)=> {
      const result = await graph.proposeImprovements(input);
      await pool.query("UPDATE workspaces SET currency='PLN' WHERE id=$1",[scope.workspaceId]);
      return result;
    }};
    await expect(new ProductImprovementReviewService(changingCurrencyGraph,store,randomUUID).propose(scope,actor)).rejects.toMatchObject({code:'CONFLICT'});
    expect((await service().read(scope))!.sessionId).toBe(review.sessionId);
  });

  it('rejects oversized generated and edited titles without changing product or review', async () => {
    const longTitleGraph = { proposeImprovements: async (input: ReviewScope) => {
      const result = await graph.proposeImprovements(input);
      result.copy[0].proposedValue = 'x'.repeat(256);
      return result;
    }};
    const review = (await new ProductImprovementReviewService(longTitleGraph, store, randomUUID).propose(scope, actor)).session!;
    const decision = { revision: 1, proposalId: review.proposals[0].proposalId, action: 'accept' as const };
    await expect(service().decide(scope, review.sessionId, decision, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service().decide(scope, review.sessionId, { ...decision, editedValue: '😀'.repeat(256) }, actor)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await service().read(scope)).toEqual(review);
    expect((await pool.query('SELECT name FROM products WHERE id=$1', [scope.productId])).rows[0].name).toBe('Original title');
    const accepted = await service().decide(scope, review.sessionId, { ...decision, editedValue: '😀'.repeat(255) }, actor);
    expect(accepted.proposals[0].editedValue).toBe('😀'.repeat(255));
    expect((await pool.query('SELECT char_length(name)::int AS length FROM products WHERE id=$1', [scope.productId])).rows[0].length).toBe(255);
  });

});
