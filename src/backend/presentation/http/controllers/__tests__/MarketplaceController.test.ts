import type { Request, Response } from 'express';
import { Marketplace } from '../../../../domain/entities/Marketplace';
import { InMemoryMarketplaceRepository, unwrap } from '../../../../domain/testkit/support';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../../../domain/shared/DomainError';
import type { OlxTrustedTaxonomyResolver } from '../../../../application/services/ProductRecheckService';
import { MarketplaceController } from '../MarketplaceController';

const WORKSPACE_ID = 'ws-1';
const RESULTS = [{ providerCategoryId: '99', name: 'Fotoaparaty', path: ['Elektronika', 'Fotoaparaty'] }];

async function seed(row: { id: string; workspaceId?: string; connected: boolean }) {
  const repo = new InMemoryMarketplaceRepository();
  await repo.save(unwrap(Marketplace.create({
    id: row.id, workspaceId: row.workspaceId ?? WORKSPACE_ID, key: 'olx', name: 'OLX', connected: row.connected,
  })));
  return repo;
}

async function search(repo: InMemoryMarketplaceRepository, resolver: unknown, id: string, query: string) {
  const controller = new MarketplaceController(
    repo, {} as never, {} as never, {} as never, undefined, '', 'stub',
    async () => {
      if (resolver instanceof Error) throw resolver;
      return resolver as OlxTrustedTaxonomyResolver;
    },
  );
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
  const next = jest.fn();
  await controller.searchCategories(
    { params: { id }, query: { query }, user: { workspaceId: WORKSPACE_ID, userId: 'u-1' } } as unknown as Request,
    res,
    next,
  );
  return { json, next };
}

describe('MarketplaceController.searchCategories', () => {
  it('returns the resolver results for a connected OLX marketplace', async () => {
    const repo = await seed({ id: 'm-1', connected: true });
    const resolver = { search: jest.fn().mockResolvedValue(RESULTS) };
    const { json, next } = await search(repo, resolver, 'm-1', 'fot');
    expect(next).not.toHaveBeenCalled();
    expect(resolver.search).toHaveBeenCalledWith('fot');
    expect(json.mock.calls[0][0].data).toEqual(RESULTS);
  });

  it('rejects a query shorter than 2 characters with a validation error', async () => {
    const repo = await seed({ id: 'm-1', connected: true });
    const resolver = { search: jest.fn() };
    const { next } = await search(repo, resolver, 'm-1', 'f');
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
    expect(resolver.search).not.toHaveBeenCalled();
  });

  it('treats a marketplace of another workspace as not found', async () => {
    const repo = await seed({ id: 'm-1', workspaceId: 'ws-other', connected: true });
    const resolver = { search: jest.fn() };
    const { next } = await search(repo, resolver, 'm-1', 'fot');
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
    expect(resolver.search).not.toHaveBeenCalled();
  });

  it('treats a disconnected marketplace as not found', async () => {
    const repo = await seed({ id: 'm-1', connected: false });
    const resolver = { search: jest.fn() };
    const { next } = await search(repo, resolver, 'm-1', 'fot');
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  it('answers 503 without the resolver error text when the resolver throws', async () => {
    const repo = await seed({ id: 'm-1', connected: true });
    const resolver = { search: jest.fn().mockRejectedValue(new Error('secret upstream detail')) };
    const { next } = await search(repo, resolver, 'm-1', 'fot');
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).not.toContain('secret upstream detail');
  });

  it('answers 503 when the resolver cannot be built', async () => {
    const repo = await seed({ id: 'm-1', connected: true });
    const { next } = await search(repo, new Error('secret factory detail'), 'm-1', 'fot');
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).not.toContain('secret factory detail');
  });
});
