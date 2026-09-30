import { ProductController, parseStringList } from '../ProductController';

describe('ProductController list parsing', () => {
  it('preserves commas inside JSON-encoded tag values', () => {
    expect(parseStringList('["home, office","featured"]')).toEqual(['home, office', 'featured']);
  });

  it('keeps backward compatibility with comma-separated tags', () => {
    expect(parseStringList('audio, featured')).toEqual(['audio', 'featured']);
  });

  it('fails closed for malformed JSON arrays', () => {
    expect(parseStringList('["unterminated"')).toBeUndefined();
    expect(parseStringList('["valid", 2]')).toBeUndefined();
  });
});

describe('ProductController recheck', () => {
  it('forwards the authenticated workspace and actor to the non-publishing service', async () => {
    const result = {
      productId: 'product-1', workspaceId: 'workspace-1',
      productUpdatedAt: '2026-07-22T06:00:00.000Z', checkedAt: '2026-07-22T06:01:00.000Z',
      status: 'ready', canPublish: true, autoApplied: false, items: [],
      category: {
        providerCategoryId: 'provider-1', path: ['Electronics', 'Projectors'], confidence: 0.99,
        isLeaf: true, taxonomyVerifiedAt: '2026-07-22T05:00:00.000Z',
        taxonomyStaleAt: '2026-07-23T05:00:00.000Z', reason: null,
        suggestion: null, confirmationRequired: false,
      },
    } as const;
    const recheck = jest.fn(async () => result);
    const controller = new ProductController(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      () => 'id', { recheck } as never,
    );
    const req = {
      params: { id: 'product-1' },
      body: { listingId: 'listing-1' },
      user: { workspaceId: 'workspace-1', userId: 'user-1' },
    } as never;
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as never;
    const next = jest.fn();

    await controller.recheck(req, res, next);

    expect(recheck).toHaveBeenCalledWith({
      productId: 'product-1', listingId: 'listing-1', workspaceId: 'workspace-1', actorId: 'user-1',
    });
    expect(json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });
});

import express from 'express';
import request from 'supertest';
import { createProductRoutes } from '../../routes/products';
import { createErrorHandler } from '../../middleware/ErrorHandlingMiddleware';
import { ConflictError, NotFoundError } from '../../../../domain/shared/DomainError';

describe('saved improvement review HTTP adapters', () => {
  const proposalId = 'd0dcd3bd-dfcb-41c1-b3a1-6bac8b52e7ab';
  function app(reviews?: { read?: jest.Mock; decide?: jest.Mock }) {
    const controller = new ProductController({} as never,{} as never,{} as never,{} as never,{} as never,{} as never,()=>'id',undefined,undefined,reviews as never);
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => { req.user = { workspaceId:'trusted-workspace', userId:'trusted-user' } as never; next(); });
    server.use('/api/products',createProductRoutes(controller));
    server.use(createErrorHandler());
    return server;
  }
  it('reads using authenticated scope and carries explicit decision and actor', async () => {
    const read = jest.fn(async () => null);
    const decide = jest.fn(async () => ({revision:2}));
    const server = app({read,decide});
    await request(server).get('/api/products/product/improvements?listingId=listing').expect(200);
    expect(read).toHaveBeenCalledWith({ workspaceId:'trusted-workspace', productId:'product',listingId:'listing' });
    await request(server).post('/api/products/product/improvements/session/decisions?listingId=listing').send({revision:1,proposalId,action:'accept',editedValue:'Seller edit'}).expect(200);
    expect(decide).toHaveBeenCalledWith({workspaceId:'trusted-workspace',productId:'product',listingId:'listing'},'session',{revision:1,proposalId,action:'accept',editedValue:'Seller edit'},'trusted-user');
  });
  it.each([
    {revision:0,proposalId,action:'accept'},
    {revision:1,proposalId,action:'publish'},
    {revision:1,proposalId,action:'reject',editedValue:'edit'},
    {revision:1,proposalId,action:'accept',workspaceId:'attacker'},
    {revision:1,proposalId,action:'accept',editedValue:-1},
  ])('rejects invalid or tenant-overriding decision bodies (%j)',async (body) => {
    const decide = jest.fn();
    await request(app({decide})).post('/api/products/product/improvements/session/decisions').send(body).expect(400);
    expect(decide).not.toHaveBeenCalled();
  });
  it('preserves conflict and not-found error responses',async()=> {
    const decide = jest.fn(async()=> { throw new ConflictError('Stale review'); });
    const read = jest.fn(async()=> { throw new NotFoundError('Review not found'); });
    await request(app({decide,read})).post('/api/products/product/improvements/session/decisions').send({revision:1,proposalId,action:'accept'}).expect(409);
    await request(app({decide,read})).get('/api/products/product/improvements').expect(404);
  });
  it('keeps legacy construction valid and reports absent persistence as unavailable',async()=> {
    await request(app()).get('/api/products/product/improvements').expect(503);
  });
});
